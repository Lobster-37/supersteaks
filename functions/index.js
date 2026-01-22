const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

/**
 * Security & Validation Utilities
 */

// Rate limiting: Track function calls per user
const rateLimitStore = new Map();

function checkRateLimit(userId, functionName, maxCalls = 10, windowMs = 60000) {
    const key = `${userId}:${functionName}`;
    const now = Date.now();
    
    if (!rateLimitStore.has(key)) {
        rateLimitStore.set(key, []);
    }
    
    const calls = rateLimitStore.get(key);
    const recentCalls = calls.filter(timestamp => now - timestamp < windowMs);
    
    if (recentCalls.length >= maxCalls) {
        throw new functions.https.HttpsError('resource-exhausted', 'Rate limit exceeded. Please try again later.');
    }
    
    recentCalls.push(now);
    rateLimitStore.set(key, recentCalls);
}

// Input validation helpers
function validateTournamentId(id) {
    if (!id || typeof id !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid tournament ID format');
    }
    if (id.length > 256 || id.length < 1) {
        throw new functions.https.HttpsError('invalid-argument', 'Tournament ID length invalid');
    }
    // Prevent NoSQL injection - only alphanumeric, hyphens, underscores
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
        throw new functions.https.HttpsError('invalid-argument', 'Tournament ID contains invalid characters');
    }
    return id;
}

function validateUserId(id) {
    if (!id || typeof id !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid user ID');
    }
    if (id.length > 256) {
        throw new functions.https.HttpsError('invalid-argument', 'User ID too long');
    }
    return id;
}

function validateTeamName(name) {
    if (!name || typeof name !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid team name');
    }
    if (name.length > 150 || name.length < 1) {
        throw new functions.https.HttpsError('invalid-argument', 'Team name length invalid');
    }
    // Allow alphanumeric, spaces, hyphens, apostrophes, periods
    if (!/^[a-zA-Z0-9\s\-'\.]+$/.test(name)) {
        throw new functions.https.HttpsError('invalid-argument', 'Team name contains invalid characters');
    }
    return name;
}

// Audit logging
async function logAudit(userId, action, details, success = true) {
    try {
        await db.collection('auditLog').add({
            userId,
            action,
            details,
            success,
            timestamp: admin.firestore.Timestamp.now(),
            ipAddress: details.ipAddress || 'unknown'
        });
    } catch (error) {
        console.error('Audit logging failed:', error);
        // Don't throw - logging failure shouldn't break the operation
    }
}

/**
 * joinTournament - Atomic tournament join with lobby assignment
 * 
 * Atomically:
 * 1. Finds tournament
 * 2. Finds/creates lobby with available slot
 * 3. Randomly assigns user a team from lobby's available teams
 * 4. Creates teamAssignment document
 * 
 * Prevents race conditions via Firestore transaction
 */
exports.joinTournament = functions.https.onCall(async (data, context) => {
    // Check authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const userId = context.auth.uid;
    
    try {
        // Validate input
        const tournamentId = validateTournamentId(data.tournamentId);
        
        // Rate limit: 10 joins per minute per user
        checkRateLimit(userId, 'joinTournament', 10, 60000);

        // Use transaction for atomicity
        const result = await db.runTransaction(async (transaction) => {
            // 1. Get tournament
            const tournamentRef = db.collection('tournaments').doc(tournamentId);
            const tournamentSnap = await transaction.get(tournamentRef);
            
            if (!tournamentSnap.exists) {
                throw new functions.https.HttpsError('not-found', 'Tournament not found');
            }

            const tournament = tournamentSnap.data();
            const teamCount = tournament.teamCount;
            
            // Validate tournament data
            if (!teamCount || typeof teamCount !== 'number' || teamCount < 1 || teamCount > 1000) {
                throw new functions.https.HttpsError('internal', 'Invalid tournament configuration');
            }
            
            // Use tournament-specific teams if available, otherwise use default list
            const allTeams = tournament.teams && Array.isArray(tournament.teams) && tournament.teams.length > 0 
                ? tournament.teams 
                : [
                    "Arsenal", "Aston Villa", "Bournemouth", "Brentford", "Brighton", "Chelsea", "Crystal Palace",
                    "Everton", "Fulham", "Ipswich Town", "Leicester City", "Liverpool", "Manchester City",
                    "Manchester United", "Newcastle United", "Nottingham Forest", "Southampton", "Tottenham",
                    "West Ham", "Wolverhampton", "AC Milan", "Atalanta", "Bologna", "Como", "Fiorentina",
                    "Genoa", "Inter Milan", "Juventus", "Napoli", "Olympiacos", "Paris Saint-Germain",
                    "Real Madrid", "Sporting CP", "Galatasaray"
                ];

            // Check if user already has active assignment in this tournament
            const existingSnap = await transaction.get(
                db.collection('teamAssignments')
                    .where('userId', '==', userId)
                    .where('tournamentId', '==', tournamentId)
            );

            if (!existingSnap.empty) {
                throw new functions.https.HttpsError('already-exists', 'User already assigned in this tournament');
            }

            // 2. Find open lobby or create new one
            let lobbySnap = await transaction.get(
                db.collection('lobbies')
                    .where('tournamentId', '==', tournamentId)
                    .where('status', '==', 'open')
                    .limit(1)
            );

            let lobbyRef, lobbyData;

            if (lobbySnap.empty) {
                // Create new lobby
                const lobbyCount = await db.collection('lobbies')
                    .where('tournamentId', '==', tournamentId)
                    .count()
                    .get();

                const newLobbyNum = lobbyCount.data().count + 1;
                const newLobbyId = `${tournamentId}_lobby_${newLobbyNum}`;
                
                lobbyRef = db.collection('lobbies').doc(newLobbyId);
                lobbyData = {
                    id: newLobbyId,
                    tournamentId,
                    lobbyId: `lobby_${newLobbyNum}`,
                    capacity: teamCount,
                    currentCount: 0,
                    userIds: [],
                    status: 'open',
                    teams: {},
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                };

                transaction.set(lobbyRef, lobbyData);
            } else {
                lobbyRef = lobbySnap.docs[0].ref;
                lobbyData = lobbySnap.docs[0].data();
            }

            // 3. Get available teams in this lobby
            const assignedTeams = Object.values(lobbyData.teams || {});
            const availableTeams = allTeams.filter(t => !assignedTeams.includes(t)).slice(0, teamCount);

            if (availableTeams.length === 0) {
                throw new functions.https.HttpsError('unavailable', 'No teams available in any lobby');
            }

            // Randomly select a team
            const team = availableTeams[Math.floor(Math.random() * availableTeams.length)];

            // 4. Create team assignment
            const assignmentRef = db.collection('teamAssignments').doc();
            const assignment = {
                id: assignmentRef.id,
                userId,
                username: context.auth.token.name || context.auth.token.email?.split('@')[0] || 'User',
                tournamentId,
                lobbyId: lobbyData.id,
                team,
                status: 'active',
                assignedAt: admin.firestore.FieldValue.serverTimestamp()
            };

            transaction.set(assignmentRef, assignment);

            // 5. Update lobby
            const updatedLobbyCounts = Object.keys(lobbyData.teams || {}).length + 1;
            const updatedLobbyUserIds = [...(lobbyData.userIds || []), userId];
            const updatedTeams = { ...(lobbyData.teams || {}), [userId]: team };
            const newStatus = updatedLobbyCounts >= teamCount ? 'full' : 'open';

            transaction.update(lobbyRef, {
                currentCount: updatedLobbyCounts,
                userIds: updatedLobbyUserIds,
                teams: updatedTeams,
                status: newStatus,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            return {
                success: true,
                assignment: {
                    ...assignment,
                    assignedAt: new Date().toISOString()
                },
                lobby: {
                    ...lobbyData,
                    currentCount: updatedLobbyCounts,
                    status: newStatus
                }
            };
        });

        return result;

    } catch (error) {
        console.error('Error in joinTournament:', error);
        
        if (error.code === 'already-exists') {
            throw error;
        } else if (error.code === 'not-found') {
            throw error;
        } else if (error.code === 'unavailable') {
            throw error;
        }
        
        throw new functions.https.HttpsError('internal', 'Failed to join tournament');
    }
});

/** * manageTournaments - Admin function to create, update, or delete tournaments
 * Usage: Call via Cloud Function with proper Firebase authentication
 * Requires: User with 'admin' custom claim set to true
 */
exports.manageTournaments = functions.https.onCall(async (data, context) => {
    // Check if user is authenticated
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be logged in');
    }

    // Check if user has admin claim
    if (!context.auth.token.admin) {
        await logAudit(context.auth.uid, 'manageTournaments_unauthorized', { action: data.action }, false);
        throw new functions.https.HttpsError('permission-denied', 'Admin privileges required');
    }

    const { action, tournaments } = data;

    if (!action || typeof action !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', 'Missing or invalid action');
    }

    if (!tournaments || !Array.isArray(tournaments)) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid tournaments data');
    }

    if (tournaments.length > 100) {
        throw new functions.https.HttpsError('invalid-argument', 'Too many tournaments at once');
    }

    try {
        if (action === 'refresh') {
            // Delete old tournaments and add new ones
            const batch = db.batch();
            
            // Delete old tournaments
            const toDelete = ["FIFA World Cup 2026", "UEFA Europa League 2025-26", "La Liga 2025-26", "Copa Libertadores 2026"];
            const snapshot = await db.collection('tournaments').get();
            
            for (const doc of snapshot.docs) {
                if (toDelete.includes(doc.data().name)) {
                    batch.delete(doc.ref);
                }
            }

            // Add new tournaments with validation
            for (const tournament of tournaments) {
                // Validate tournament data
                if (!tournament.name || typeof tournament.name !== 'string' || tournament.name.length > 200) {
                    throw new functions.https.HttpsError('invalid-argument', 'Invalid tournament name');
                }
                if (!tournament.teamCount || typeof tournament.teamCount !== 'number' || tournament.teamCount < 1 || tournament.teamCount > 1000) {
                    throw new functions.https.HttpsError('invalid-argument', 'Invalid team count');
                }
                if (tournament.teams && !Array.isArray(tournament.teams)) {
                    throw new functions.https.HttpsError('invalid-argument', 'Teams must be an array');
                }
                
                const newTournament = {
                    ...tournament,
                    createdAt: admin.firestore.Timestamp.now(),
                    createdBy: context.auth.uid,
                    status: 'active'
                };
                batch.set(db.collection('tournaments').doc(), newTournament);
            }

            await batch.commit();
            return { success: true, message: `Refreshed ${tournaments.length} tournaments` };

        } else if (action === 'create') {
            // Add new tournaments without deleting
            const batch = db.batch();
            const ids = [];

            for (const tournament of tournaments) {
                const docRef = db.collection('tournaments').doc();
                const newTournament = {
                    ...tournament,
                    createdAt: admin.firestore.Timestamp.now(),
                    createdBy: context.auth.uid,
                    status: 'active'
                };
                batch.set(docRef, newTournament);
                ids.push(docRef.id);
            }

            await batch.commit();
            return { success: true, message: `Created ${tournaments.length} tournaments`, ids };

        } else if (action === 'delete') {
            // Delete specific tournaments by name
            const batch = db.batch();
            const snapshot = await db.collection('tournaments').get();
            let deleted = 0;

            for (const doc of snapshot.docs) {
                if (tournaments.includes(doc.data().name)) {
                    batch.delete(doc.ref);
                    deleted++;
                }
            }

            await batch.commit();
            return { success: true, message: `Deleted ${deleted} tournaments` };
        }

        throw new functions.https.HttpsError('invalid-argument', 'Invalid action');

    } catch (error) {
        console.error('Error in manageTournaments:', error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});

/**
 * addTournamentsAdmin - HTTP endpoint for programmatic tournament addition
 * DEPRECATED: Use manageTournaments Cloud Function instead (requires Firebase auth + admin claim)
 * Kept for backward compatibility but validates using Firebase Custom Claims
 */
exports.addTournamentsAdmin = functions.https.onRequest(async (req, res) => {
    // Only accept POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Validate Firebase ID token if provided
    const authHeader = req.headers.authorization;
    let adminVerified = false;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
            const token = authHeader.substring(7);
            const decodedToken = await admin.auth().verifyIdToken(token);
            
            // Check if user has admin claim
            if (decodedToken.admin === true) {
                adminVerified = true;
            }
        } catch (error) {
            console.error('Token verification failed:', error);
        }
    }

    // Fallback: check for legacy admin secret (from environment variable, not hardcoded)
    const legacySecret = process.env.ADMIN_SECRET;
    const providedSecret = req.headers['x-admin-secret'];
    
    if (!adminVerified && (!legacySecret || providedSecret !== legacySecret)) {
        await logAudit('unknown', 'addTournamentsAdmin_unauthorized', { method: req.method }, false);
        return res.status(403).json({ error: 'Unauthorized - invalid credentials' });
    }

    const { action } = req.body;
    const tournaments = req.body.tournaments || [];

    if (!action || typeof action !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid action' });
    }

    if (tournaments && !Array.isArray(tournaments)) {
        return res.status(400).json({ error: 'Invalid tournaments data' });
    }

    try {
        if (action === 'deleteAll') {
            const batch = db.batch();
            const snapshot = await db.collection('tournaments').get();
            for (const doc of snapshot.docs) {
                batch.delete(doc.ref);
            }
            await batch.commit();
            await logAudit('admin', 'deleteAll_tournaments', { count: snapshot.size }, true);
            return res.status(200).json({ message: 'All tournaments deleted successfully', count: snapshot.size });
        } else if (action === 'updateTeams') {
            // Safely update team rosters WITHOUT changing tournament IDs or deleting tournaments
            // Maps tournaments by name and updates their team lists
            const batch = db.batch();
            const snapshot = await db.collection('tournaments').get();
            
            const tournamentMap = new Map();
            snapshot.docs.forEach(doc => {
                tournamentMap.set(doc.data().name, { id: doc.id, ref: doc.ref });
            });

            let updated = 0;
            for (const tournament of tournaments) {
                const existing = tournamentMap.get(tournament.name);
                if (existing) {
                    // Update existing tournament with new team data
                    batch.update(existing.ref, {
                        teams: tournament.teams,
                        teamCount: tournament.teamCount,
                        description: tournament.description,
                        updatedAt: admin.firestore.Timestamp.now()
                    });
                    updated++;
                } else {
                    // Tournament doesn't exist, create it
                    batch.set(db.collection('tournaments').doc(), {
                        ...tournament,
                        createdAt: admin.firestore.Timestamp.now(),
                        createdBy: 'admin',
                        status: 'active'
                    });
                }
            }

            await batch.commit();
            return res.json({ 
                success: true, 
                message: `Updated ${updated} tournaments, created ${tournaments.length - updated} new ones`,
                updated,
                created: tournaments.length - updated
            });
        } else if (action === 'refresh') {
            const batch = db.batch();
            const toDelete = ["FIFA World Cup 2026", "UEFA Europa League 2025-26", "La Liga 2025-26", "Copa Libertadores 2026", "Ligue 1 2025-26", "Ligue 2 2025-26"];
            const snapshot = await db.collection('tournaments').get();
            
            for (const doc of snapshot.docs) {
                if (toDelete.includes(doc.data().name)) {
                    batch.delete(doc.ref);
                }
            }

            for (const tournament of tournaments) {
                const newTournament = {
                    ...tournament,
                    createdAt: admin.firestore.Timestamp.now(),
                    createdBy: 'admin',
                    status: 'active'
                };
                batch.set(db.collection('tournaments').doc(), newTournament);
            }

            await batch.commit();
            return res.json({ success: true, message: `Added ${tournaments.length} tournaments`, count: tournaments.length });
        } else if (action === 'migrateChampionsOrphans') {
            // Move any orphaned lobbies/teamAssignments (with tournamentIds not in current tournaments)
            // to the current Champions League tournament
            const tournamentsSnap = await db.collection('tournaments').get();
            const validIds = new Set(tournamentsSnap.docs.map(d => d.id));
            const championsDoc = tournamentsSnap.docs.find(d => (d.data().name || '').includes('UEFA Champions League'));

            if (!championsDoc) {
                return res.status(404).json({ error: 'No Champions League tournament found to attach orphans' });
            }

            const championsId = championsDoc.id;

            const assignmentsSnap = await db.collection('teamAssignments').get();
            const lobbiesSnap = await db.collection('lobbies').get();

            const orphanAssignments = assignmentsSnap.docs.filter(doc => !validIds.has(doc.data().tournamentId));
            const orphanLobbies = lobbiesSnap.docs.filter(doc => !validIds.has(doc.data().tournamentId));

            // Batch updates (chunk to avoid 500 limit)
            const updates = [];
            for (const doc of orphanAssignments) {
                updates.push({ ref: doc.ref, data: { tournamentId: championsId } });
            }
            for (const doc of orphanLobbies) {
                updates.push({ ref: doc.ref, data: { tournamentId: championsId } });
            }

            // Commit in chunks of 400
            let updated = 0;
            for (let i = 0; i < updates.length; i += 400) {
                const batch = db.batch();
                for (const item of updates.slice(i, i + 400)) {
                    batch.update(item.ref, item.data);
                }
                await batch.commit();
                updated += Math.min(400, updates.length - i);
            }

            return res.json({ success: true, message: 'Orphans migrated to Champions League', assignments: orphanAssignments.length, lobbies: orphanLobbies.length, updated });
        } else if (action === 'cleanupDuplicates') {
            // Remove duplicate assignments - keep only the most recent per user per tournament
            const assignmentsSnap = await db.collection('teamAssignments').get();
            
            // Group by userId + tournamentId
            const grouped = {};
            assignmentsSnap.docs.forEach(doc => {
                const data = doc.data();
                const key = `${data.userId}_${data.tournamentId}`;
                if (!grouped[key]) {
                    grouped[key] = [];
                }
                grouped[key].push({ id: doc.id, ...data });
            });
            
            // For each group with duplicates, keep newest and delete rest
            let deleted = 0;
            const batch = db.batch();
            for (const [key, assignments] of Object.entries(grouped)) {
                if (assignments.length > 1) {
                    // Sort by assignedAt descending (newest first)
                    assignments.sort((a, b) => {
                        const dateA = a.assignedAt?.toDate?.() || new Date(a.assignedAt);
                        const dateB = b.assignedAt?.toDate?.() || new Date(b.assignedAt);
                        return dateB - dateA;
                    });
                    
                    // Delete all except the first (newest)
                    for (let i = 1; i < assignments.length; i++) {
                        batch.delete(db.collection('teamAssignments').doc(assignments[i].id));
                        deleted++;
                    }
                }
            }
            
            await batch.commit();
            return res.json({ success: true, message: 'Duplicate assignments cleaned up', deleted });
        }

        return res.status(400).json({ error: 'Invalid action' });

    } catch (error) {
        console.error('Error in addTournamentsAdmin:', error);
        return res.status(500).json({ error: error.message });
    }
});

/**
 * Daily backup function - exports critical collections to Cloud Storage
 * Runs daily at 2 AM UTC
 */
exports.dailyBackup = functions.pubsub.schedule('0 2 * * *').timeZone('UTC').onRun(async (context) => {
    const timestamp = new Date().toISOString().split('T')[0];
    const collections = ['tournaments', 'teamAssignments', 'lobbies', 'users'];
    
    const backups = {};
    
    for (const collectionName of collections) {
        const snapshot = await db.collection(collectionName).get();
        backups[collectionName] = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    }
    
    // Store in Firestore backups collection (you could also use Cloud Storage)
    await db.collection('backups').doc(`backup_${timestamp}`).set({
        timestamp: admin.firestore.Timestamp.now(),
        date: timestamp,
        collections: backups,
        counts: {
            tournaments: backups.tournaments.length,
            teamAssignments: backups.teamAssignments.length,
            lobbies: backups.lobbies.length,
            users: backups.users.length
        }
    });
    
    console.log(`✅ Backup created for ${timestamp}`);
    return null;
});

/**
 * Manual backup trigger - HTTP endpoint with improved security
 */
exports.createBackup = functions.https.onRequest(async (req, res) => {
    // Only accept POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Validate Firebase ID token if provided (preferred method)
    let adminVerified = false;
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
            const token = authHeader.substring(7);
            const decodedToken = await admin.auth().verifyIdToken(token);
            
            if (decodedToken.admin === true) {
                adminVerified = true;
            }
        } catch (error) {
            console.error('Token verification failed:', error);
        }
    }

    // Fallback: check for legacy admin secret (from environment variable only)
    const legacySecret = process.env.ADMIN_SECRET;
    const providedSecret = req.headers['x-admin-secret'];
    
    if (!adminVerified && (!legacySecret || providedSecret !== legacySecret)) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const timestamp = new Date().toISOString();
    const collections = ['tournaments', 'teamAssignments', 'lobbies', 'users'];
    
    const backups = {};
    
    for (const collectionName of collections) {
        const snapshot = await db.collection(collectionName).get();
        backups[collectionName] = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    }
    
    const backupDoc = `backup_${timestamp}`;
    await db.collection('backups').doc(backupDoc).set({
        timestamp: admin.firestore.Timestamp.now(),
        date: timestamp,
        collections: backups,
        counts: {
            tournaments: backups.tournaments.length,
            teamAssignments: backups.teamAssignments.length,
            lobbies: backups.lobbies.length,
            users: backups.users.length
        }
    });
    
    return res.json({ 
        success: true, 
        message: 'Backup created',
        backupId: backupDoc,
        counts: backups
    });
});

/**
 * getTournamentTeamVisibility - Returns only the teams visible to the current user
 * Filters tournament data to show ONLY teams from the user's assigned lobby
 * 
 * This is the critical access control function that prevents cross-lobby team viewing.
 */
exports.getTournamentTeamVisibility = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const userId = context.auth.uid;
    const tournamentId = data.tournamentId;

    if (!tournamentId) {
        throw new functions.https.HttpsError('invalid-argument', 'tournamentId required');
    }

    try {
        // Get user's assignment in this tournament
        const assignmentSnap = await db.collection('teamAssignments')
            .where('userId', '==', userId)
            .where('tournamentId', '==', tournamentId)
            .limit(1)
            .get();

        if (assignmentSnap.empty) {
            throw new functions.https.HttpsError('not-found', 'User not assigned to this tournament');
        }

        const userAssignment = assignmentSnap.docs[0].data();
        const userLobbyId = userAssignment.lobbyId;

        // Get the user's lobby
        const lobbySnap = await db.collection('lobbies').doc(userLobbyId).get();
        
        if (!lobbySnap.exists) {
            throw new functions.https.HttpsError('not-found', 'Lobby not found');
        }

        const lobby = lobbySnap.data();

        // Get tournament data
        const tournamentSnap = await db.collection('tournaments').doc(tournamentId).get();
        
        if (!tournamentSnap.exists) {
            throw new functions.https.HttpsError('not-found', 'Tournament not found');
        }

        const tournament = tournamentSnap.data();

        // Get ALL team assignments in this lobby to show visible teams
        const lobbyAssignmentsSnap = await db.collection('teamAssignments')
            .where('lobbyId', '==', userLobbyId)
            .where('tournamentId', '==', tournamentId)
            .get();

        const visibleTeams = {};
        lobbyAssignmentsSnap.docs.forEach(doc => {
            const assignment = doc.data();
            visibleTeams[assignment.userId] = assignment.team;
        });

        // Return tournament data with ONLY the user's lobby teams
        return {
            tournament: {
                id: tournamentId,
                name: tournament.name,
                teamCount: tournament.teamCount,
                description: tournament.description
            },
            lobby: {
                id: userLobbyId,
                currentCount: lobby.currentCount,
                capacity: lobby.capacity
            },
            userAssignment: {
                team: userAssignment.team,
                lobbyId: userAssignment.lobbyId
            },
            visibleTeams: visibleTeams, // Only teams in user's lobby
            visibleTeamList: Object.values(visibleTeams), // Array of visible teams
            allTournamentsTeams: undefined // HIDDEN - not sent to client
        };
    } catch (error) {
        console.error('Error in getTournamentTeamVisibility:', error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});

/**
 * ONE-TIME USE: Make yourself admin
 * Call this once while logged in as ekul.kcol@gmail.com to grant admin access
 * After you're admin, this function will be disabled
 */
exports.makeFirstAdmin = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    }

    const userId = context.auth.uid;
    const userEmail = context.auth.token.email;

    // Only allow ekul.kcol@gmail.com to use this
    if (userEmail !== 'ekul.kcol@gmail.com') {
        throw new functions.https.HttpsError('permission-denied', 'This function is for initial setup only');
    }

    try {
        // Set admin claim
        await admin.auth().setCustomUserClaims(userId, { admin: true });
        
        // Log this event
        await logAudit(userId, 'makeFirstAdmin', { email: userEmail }, true);
        
        return { 
            success: true, 
            message: `Admin claim set for ${userEmail}. Sign out and sign back in for it to take effect.` 
        };
    } catch (error) {
        console.error('Error setting admin claim:', error);
        throw new functions.https.HttpsError('internal', 'Failed to set admin claim');
    }
});

// Contact Form Submission
exports.submitContactForm = functions.https.onCall(async (data, context) => {
    // Validate input
    const { name, email, message } = data;
    
    if (!name || typeof name !== 'string' || name.trim().length === 0 || name.length > 100) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid name');
    }
    
    if (!email || typeof email !== 'string' || !email.includes('@') || email.length > 100) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid email');
    }
    
    if (!message || typeof message !== 'string' || message.trim().length === 0 || message.length > 2000) {
        throw new functions.https.HttpsError('invalid-argument', 'Message must be between 1 and 2000 characters');
    }
    
    // Rate limiting - 3 messages per hour per IP or user
    const identifier = context.auth ? context.auth.uid : context.rawRequest.ip;
    const rateLimitKey = `contact_${identifier}`;
    
    if (!rateLimitStore[rateLimitKey]) {
        rateLimitStore[rateLimitKey] = [];
    }
    
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    rateLimitStore[rateLimitKey] = rateLimitStore[rateLimitKey].filter(time => time > oneHourAgo);
    
    if (rateLimitStore[rateLimitKey].length >= 3) {
        throw new functions.https.HttpsError('resource-exhausted', 'Too many messages. Please wait an hour before sending another.');
    }
    
    rateLimitStore[rateLimitKey].push(now);
    
    try {
        // Save to Firestore
        const contactMessage = {
            name: name.trim(),
            email: email.trim().toLowerCase(),
            message: message.trim(),
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            userId: context.auth ? context.auth.uid : null,
            ipAddress: context.rawRequest.ip || 'unknown',
            status: 'new',
            read: false
        };
        
        const docRef = await db.collection('contactMessages').add(contactMessage);
        
        console.log(`Contact form submitted: ${docRef.id} from ${email}`);
        
        // Send email notification to admin
        const adminEmail = process.env.ADMIN_EMAIL || 'ekul.kcol@gmail.com';
        await db.collection('mail').add({
            to: adminEmail,
            message: {
                subject: `New Contact Form: ${name}`,
                text: `New message from ${name} (${email}):\n\n${message}\n\nSubmitted: ${new Date().toISOString()}`,
                html: `<h3>New Contact Form Submission</h3>
                       <p><strong>From:</strong> ${name} (${email})</p>
                       <p><strong>Message:</strong></p>
                       <p>${message.replace(/\n/g, '<br>')}</p>
                       <p><small>Submitted: ${new Date().toISOString()}</small></p>`
            }
        });
        
        return { 
            success: true, 
            message: 'Your message has been sent! We\'ll get back to you within 24-48 hours.' 
        };
    } catch (error) {
        console.error('Error saving contact message:', error);
        throw new functions.https.HttpsError('internal', 'Failed to submit message. Please try again.');
    }
});

/** * Legacy enterDraw function - kept for backward compatibility
 * Can be removed once all clients migrate to joinTournament
 */
// TODO: Remove this after full migration to tournament system

