const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

/**
 * TheSportsDB API Integration (Free)
 * API Documentation: https://www.thesportsdb.com/api.php
 * Free API Key: "3" (test key, supports all features)
 * Endpoints used:
 * - eventsseason: Get all matches for a season
 * - eventsround: Get fixtures for specific rounds
 * - lookuptable: Get current standings (limited to top 5 teams on free tier)
 */

// Point deductions by team (updated manually as needed)
const POINT_DEDUCTIONS = {
    'championship': {
        'Leicester City': -6,
        'Sheffield Wednesday': -18
    },
    'premier-league': {},
    'league-one': {},
    'league-two': {},
    'champions-league': {}
};

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
 * onUserSignup - Logs each newly created Firebase Auth user for admin monitoring
 */
exports.onUserSignup = functions.auth.user().onCreate(async (user) => {
    try {
        const signupData = {
            uid: user.uid,
            email: user.email || null,
            displayName: user.displayName || null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            providerIds: (user.providerData || []).map(provider => provider.providerId).filter(Boolean)
        };

        await db.collection('signupNotifications').doc(user.uid).set(signupData, { merge: true });

        await logAudit(user.uid, 'user_signup', {
            email: user.email || null,
            displayName: user.displayName || null,
            source: 'auth.onCreate'
        });

        console.log('New user signup logged:', user.uid, user.email || 'no-email');
    } catch (error) {
        console.error('Failed to log user signup:', error);
    }
});

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

/**
 * TheSportsDB API Integration
 * Fetches fixtures, results, and standings for configured leagues
 * Free API with no rate limits
 */

const axios = require('axios');
const SPORTSDB_API_KEY = '3'; // Free test key
const SPORTSDB_BASE_URL = 'https://www.thesportsdb.com/api/v1/json';

// League configuration with TheSportsDB IDs
const LEAGUES = {
    'premier-league': { 
        id: 4328, 
        name: 'Premier League', 
        season: '2025-2026'
    },
    'championship': { 
        id: 4329, 
        name: 'Championship', 
        season: '2025-2026'
    },
    'league-one': { 
        id: 4396, 
        name: 'League One', 
        season: '2025-2026'
    },
    'league-two': { 
        id: 4397, 
        name: 'League Two', 
        season: '2025-2026'
    },
    'champions-league': { 
        id: 4480, 
        name: 'Champions League', 
        season: '2025-2026'
    }
};

// Optional shared secret for HTTP-triggered backfill (fallback value for convenience)
const FETCH_MISSING_SECRET = process.env.FETCH_MISSING_SECRET || (functions.config().fetch && functions.config().fetch.secret) || 'temp-secret-123';

// Utility: Query TheSportsDB API with retry and backoff
async function querySportsDB(endpoint) {
    const maxRetries = 2;
    let retryCount = 0;
    const requestTimeout = 5000; // 5-second timeout per request
    
    while (retryCount < maxRetries) {
        try {
            const response = await axios.get(`${SPORTSDB_BASE_URL}/${SPORTSDB_API_KEY}${endpoint}`, {
                timeout: requestTimeout
            });
            return response.data;
        } catch (error) {
            retryCount++;
            if (error.response && error.response.status === 429 && retryCount < maxRetries) {
                // Exponential backoff: 1s, 2s
                const waitTime = Math.pow(2, retryCount) * 500;
                    console.warn(`Got 429, retrying in ${waitTime}ms (attempt ${retryCount}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
            } else if (error.code === 'ECONNABORTED' && retryCount < maxRetries) {
                // Timeout - retry with short delay
                console.warn(`Request timeout, retrying (attempt ${retryCount}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, 100));
                continue;
            }
            console.error(`TheSportsDB API error: ${error.message}`);
            return null;
        }
    }
    
    return null;
}

function buildStandingsFromResults(resultsSnapshot, leagueKey = '') {
    const standingsMap = {};

    resultsSnapshot.forEach(doc => {
        const result = doc.data();
        const { homeTeam, awayTeam, homeScore, awayScore } = result;
        if (homeScore === null || awayScore === null) return;

        const homeGoals = parseInt(homeScore) || 0;
        const awayGoals = parseInt(awayScore) || 0;

        if (!standingsMap[homeTeam]) {
            standingsMap[homeTeam] = { 
                team: homeTeam, 
                played: 0, 
                won: 0, 
                drawn: 0, 
                lost: 0, 
                goalsFor: 0, 
                goalsAgainst: 0, 
                goalDifference: 0, 
                points: 0 
            };
        }
        if (!standingsMap[awayTeam]) {
            standingsMap[awayTeam] = { 
                team: awayTeam, 
                played: 0, 
                won: 0, 
                drawn: 0, 
                lost: 0, 
                goalsFor: 0, 
                goalsAgainst: 0, 
                goalDifference: 0, 
                points: 0 
            };
        }

        standingsMap[homeTeam].played++;
        standingsMap[awayTeam].played++;
        standingsMap[homeTeam].goalsFor += homeGoals;
        standingsMap[homeTeam].goalsAgainst += awayGoals;
        standingsMap[awayTeam].goalsFor += awayGoals;
        standingsMap[awayTeam].goalsAgainst += homeGoals;

        if (homeGoals > awayGoals) {
            standingsMap[homeTeam].won++;
            standingsMap[homeTeam].points += 3;
            standingsMap[awayTeam].lost++;
        } else if (homeGoals < awayGoals) {
            standingsMap[awayTeam].won++;
            standingsMap[awayTeam].points += 3;
            standingsMap[homeTeam].lost++;
        } else {
            standingsMap[homeTeam].drawn++;
            standingsMap[awayTeam].drawn++;
            standingsMap[homeTeam].points += 1;
            standingsMap[awayTeam].points += 1;
        }

        standingsMap[homeTeam].goalDifference = standingsMap[homeTeam].goalsFor - standingsMap[homeTeam].goalsAgainst;
        standingsMap[awayTeam].goalDifference = standingsMap[awayTeam].goalsFor - standingsMap[awayTeam].goalsAgainst;
    });

    // Apply point deductions
    const deductions = POINT_DEDUCTIONS[leagueKey] || {};
    Object.keys(deductions).forEach(teamName => {
        if (standingsMap[teamName]) {
            standingsMap[teamName].points += deductions[teamName]; // deductions are negative
        }
    });

    const calculatedArray = Object.values(standingsMap);
    calculatedArray.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
        if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
        return a.team.localeCompare(b.team);
    });

    return calculatedArray.map((team, index) => ({
        position: index + 1,
        teamName: team.team,
        played: team.played,
        won: team.won,
        drawn: team.drawn,
        lost: team.lost,
        goalsFor: team.goalsFor,
        goalsAgainst: team.goalsAgainst,
        goalDifference: team.goalDifference,
        points: team.points
    }));
}


// Utility: Determine current round from match data
function getCurrentRound(matches) {
    const now = new Date();
    let maxCompletedRound = 0;
    let minUpcomingRound = 999;
    
    matches.forEach(match => {
        const round = parseInt(match.intRound) || 0;
        if (match.intHomeScore !== null && match.intAwayScore !== null) {
            maxCompletedRound = Math.max(maxCompletedRound, round);
        } else {
            minUpcomingRound = Math.min(minUpcomingRound, round);
        }
    });
    
    return minUpcomingRound < 999 ? minUpcomingRound : maxCompletedRound + 1;
}

// Utility: clear a subcollection to avoid stale data between seasons
async function clearSubcollection(parentRef, subcollection) {
    const snap = await parentRef.collection(subcollection).limit(400).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    if (snap.size === 400) {
        await clearSubcollection(parentRef, subcollection);
    }
}

// Move future-dated results with no score back into fixtures
async function moveFutureNoScoreResultsToFixtures(leagueRef, todayStr) {
    let lastDoc = null;
    while (true) {
        let query = leagueRef.collection('results')
            .where('date', '>=', todayStr)
            .limit(400);
        if (lastDoc) {
            query = query.startAfter(lastDoc);
        }
        const snap = await query.get();
        if (snap.empty) return;

        const batch = db.batch();
        snap.docs.forEach(doc => {
            const data = doc.data();
            const hasScore = data.homeScore !== null && data.homeScore !== undefined
                && data.awayScore !== null && data.awayScore !== undefined;
            if (!hasScore) {
                const fixtureRef = leagueRef.collection('fixtures').doc(doc.id);
                batch.set(fixtureRef, {
                    eventId: data.eventId,
                    homeTeam: data.homeTeam,
                    awayTeam: data.awayTeam,
                    date: data.date,
                    time: data.time,
                    venue: data.venue || null,
                    timestamp: data.timestamp
                });
                batch.delete(doc.ref);
            }
        });

        await batch.commit();
        if (snap.size < 400) return;
        lastDoc = snap.docs[snap.docs.length - 1];
    }
}

// Manual result entry (admin-only) + standings rebuild
exports.submitMatchResult = functions.https.onCall(async (data, context) => {
    if (!context.auth || !context.auth.token || !context.auth.token.admin) {
        throw new functions.https.HttpsError('permission-denied', 'Admin access required');
    }

    const leagueKey = data.league;
    if (!leagueKey || typeof leagueKey !== 'string' || !LEAGUES[leagueKey]) {
        throw new functions.https.HttpsError('invalid-argument', 'Unknown league');
    }

    const homeTeam = validateTeamName(data.homeTeam);
    const awayTeam = validateTeamName(data.awayTeam);
    if (homeTeam === awayTeam) {
        throw new functions.https.HttpsError('invalid-argument', 'Home and away teams must be different');
    }

    const homeScore = parseInt(data.homeScore, 10);
    const awayScore = parseInt(data.awayScore, 10);
    if (Number.isNaN(homeScore) || Number.isNaN(awayScore) || homeScore < 0 || awayScore < 0) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid score values');
    }

    const matchDate = data.matchDate;
    if (!matchDate || typeof matchDate !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid match date');
    }
    const timeStr = '15:00:00';
    const ts = new Date(`${matchDate}T${timeStr}`);
    if (isNaN(ts.getTime())) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid match date');
    }

    const leagueRef = db.collection('leagues').doc(leagueKey);
    await leagueRef.set({
        name: LEAGUES[leagueKey].name,
        leagueId: LEAGUES[leagueKey].id,
        season: LEAGUES[leagueKey].season,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    const slugify = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const resultId = `manual_${matchDate}_${slugify(homeTeam)}_${slugify(awayTeam)}`;

    await leagueRef.collection('results').doc(resultId).set({
        eventId: resultId,
        homeTeam,
        awayTeam,
        homeScore,
        awayScore,
        date: matchDate,
        time: timeStr,
        venue: data.venue || null,
        timestamp: ts,
        source: 'manual',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    await clearSubcollection(leagueRef, 'standings');
    const resultsSnapshot = await leagueRef.collection('results').get();
    const standingsArray = buildStandingsFromResults(resultsSnapshot, leagueKey);

    const batch = db.batch();
    standingsArray.forEach((team, index) => {
        const position = team.position || index + 1;
        const standingRef = leagueRef.collection('standings').doc(`${position}`);
        batch.set(standingRef, {
            position,
            teamName: team.teamName,
            played: team.played,
            won: team.won,
            drawn: team.drawn,
            lost: team.lost,
            goalsFor: team.goalsFor,
            goalsAgainst: team.goalsAgainst,
            goalDifference: team.goalDifference,
            points: team.points
        });
    });
    await batch.commit();

    return { success: true, league: LEAGUES[leagueKey].name, teams: standingsArray.length };
});

async function updateLeagueData(leagueKey) {
    const leagueConfig = LEAGUES[leagueKey];
    if (!leagueConfig) {
        console.warn(`No league config for ${leagueKey}`);
        return;
    }

    // Use start of today (00:00:00) as cutoff for past vs future
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];
    console.log(`Today date cutoff: ${todayStr}`);

    try {
        console.log(`Fetching data for ${leagueConfig.name} (season ${leagueConfig.season})...`);
        const leagueRef = db.collection('leagues').doc(leagueKey);

        await leagueRef.set({
            name: leagueConfig.name,
            leagueId: leagueConfig.id,
            season: leagueConfig.season,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        // Round selection
        const allMatches = [];
        let startRound, endRound;

        if (leagueKey === 'premier-league') {
            // Fixed safe range for Premier League
            startRound = 19;
            endRound = 38;
        } else if (leagueKey === 'championship') {
            // Current round + next 10 rounds for Championship
            const nextData = await querySportsDB(`/eventsnextleague.php?id=${leagueConfig.id}`);
            let nextRound = 2;

            if (nextData && nextData.events && nextData.events.length > 0) {
                const roundSet = new Set();
                nextData.events.forEach(event => {
                    if (event.intRound) {
                        roundSet.add(parseInt(event.intRound));
                    }
                });
                if (roundSet.size > 0) {
                    nextRound = Math.min(...Array.from(roundSet));
                }
            } else {
                console.warn('Championship: No next-round data; using fallback rounds 1-11');
            }

            const currentRound = Math.max(1, nextRound - 1);
            startRound = currentRound;
            endRound = Math.min(currentRound + 10, 46);
            console.log(`Championship rounds ${startRound}-${endRound} (current ${currentRound}, next ${nextRound})`);
        } else if (leagueKey === 'league-one') {
            // Current round + next 10 rounds for League One
            const nextData = await querySportsDB(`/eventsnextleague.php?id=${leagueConfig.id}`);
            let nextRound = 2;

            if (nextData && nextData.events && nextData.events.length > 0) {
                const roundSet = new Set();
                nextData.events.forEach(event => {
                    if (event.intRound) {
                        roundSet.add(parseInt(event.intRound));
                    }
                });
                if (roundSet.size > 0) {
                    nextRound = Math.min(...Array.from(roundSet));
                }
            } else {
                console.warn('League One: No next-round data; using fallback rounds 1-11');
            }

            const currentRound = Math.max(1, nextRound - 1);
            startRound = currentRound;
            endRound = Math.min(currentRound + 10, 46);
            console.log(`League One rounds ${startRound}-${endRound} (current ${currentRound}, next ${nextRound})`);
        } else if (leagueKey === 'league-two') {
            // Current round + next 10 rounds for League Two
            const nextData = await querySportsDB(`/eventsnextleague.php?id=${leagueConfig.id}`);
            let nextRound = 2;

            if (nextData && nextData.events && nextData.events.length > 0) {
                const roundSet = new Set();
                nextData.events.forEach(event => {
                    if (event.intRound) {
                        roundSet.add(parseInt(event.intRound));
                    }
                });
                if (roundSet.size > 0) {
                    nextRound = Math.min(...Array.from(roundSet));
                }
            } else {
                console.warn('League Two: No next-round data; using fallback rounds 1-11');
            }

            const currentRound = Math.max(1, nextRound - 1);
            startRound = currentRound;
            endRound = Math.min(currentRound + 10, 46);
            console.log(`League Two rounds ${startRound}-${endRound} (current ${currentRound}, next ${nextRound})`);
        } else if (leagueKey === 'champions-league') {
            // Current round + next 10 rounds for Champions League
            const nextData = await querySportsDB(`/eventsnextleague.php?id=${leagueConfig.id}`);
            let nextRound = 2;

            if (nextData && nextData.events && nextData.events.length > 0) {
                const roundSet = new Set();
                nextData.events.forEach(event => {
                    if (event.intRound) {
                        roundSet.add(parseInt(event.intRound));
                    }
                });
                if (roundSet.size > 0) {
                    nextRound = Math.min(...Array.from(roundSet));
                }
            } else {
                console.warn('Champions League: No next-round data; using fallback rounds 1-11');
            }

            const currentRound = Math.max(1, nextRound - 1);
            startRound = currentRound;
            endRound = Math.min(currentRound + 10, 12);
            console.log(`Champions League rounds ${startRound}-${endRound} (current ${currentRound}, next ${nextRound})`);
        } else {
            startRound = 1;
            endRound = 20;
        }

        for (let round = startRound; round <= endRound; round++) {
            const roundData = await querySportsDB(`/eventsround.php?id=${leagueConfig.id}&r=${round}&s=${leagueConfig.season}`);
            if (roundData && roundData.events && roundData.events.length > 0) {
                allMatches.push(...roundData.events);
                console.log(`Round ${round}: ${roundData.events.length} matches`);
            } else {
                console.warn(`No data for round ${round} (${leagueConfig.name})`);
            }
        }

        console.log(`Fetched ${allMatches.length} total matches for ${leagueConfig.name} from rounds ${startRound}-${endRound}`);

        // Deduplicate by event ID
        const uniqueMatches = new Map();
        allMatches.forEach(match => {
            if (match && match.idEvent) {
                uniqueMatches.set(match.idEvent, match);
            }
        });

        const allEvents = Array.from(uniqueMatches.values()).map(match => ({
            idEvent: match.idEvent,
            dateEvent: match.dateEvent,
            strTime: match.strTime || match.strTimeLocal || '15:00:00',
            strHomeTeam: match.strHomeTeam,
            strAwayTeam: match.strAwayTeam,
            intHomeScore: match.intHomeScore,
            intAwayScore: match.intAwayScore,
            strVenue: match.strVenue || null,
            status: match.strStatus || 'Unknown'
        }));

        console.log(`Parsed ${allEvents.length} total events for ${leagueConfig.name}`);
        if (allEvents.length) {
            const sample = allEvents.slice(0, 3).map(ev => ({ id: ev.idEvent, date: ev.dateEvent, time: ev.strTime, home: ev.strHomeTeam, away: ev.strAwayTeam, homeScore: ev.intHomeScore, awayScore: ev.intAwayScore }));
            console.log(`Sample events: ${JSON.stringify(sample)}`);
        }

        // Split events into fixtures (future/today) and results (past)
        const fixturesBatch = db.batch();
        const resultsBatch = db.batch();
        let fixturesCount = 0;
        let resultsCount = 0;

        allEvents.forEach(event => {
            if (!event || !event.dateEvent) {
                return;
            }
            const dateStr = event.dateEvent;
            const timeStr = event.strTime || '15:00:00';
            const ts = new Date(`${dateStr}T${timeStr}`);
            if (isNaN(ts.getTime())) {
                console.warn(`Skipping event with invalid timestamp: ${event.idEvent} ${dateStr} ${timeStr}`);
                return;
            }
            const hasScore = event.intHomeScore !== null && event.intAwayScore !== null;
            const isFinished = event.status && event.status.toLowerCase().includes('match finished');

            // Classify by match date (scores take precedence)
            // If it has a score or finished status, it's a result
            // Otherwise, if the match date is today or later, keep as fixture
            const isFutureOrToday = ts >= today;
            const isResult = hasScore || isFinished;

            // Debug: log some event classification info
            if (fixturesCount + resultsCount < 5) {
                console.log(`Event ${event.idEvent} (${dateStr}): isFutureOrToday=${isFutureOrToday}, isResult=${isResult}, hasScore=${hasScore}, status=${event.status}`);
            }

            // Classify as result or fixture
            if (isResult) {
                const resultRef = leagueRef.collection('results').doc(event.idEvent);
                resultsBatch.set(resultRef, {
                    eventId: event.idEvent,
                    homeTeam: event.strHomeTeam,
                    awayTeam: event.strAwayTeam,
                    homeScore: event.intHomeScore,
                    awayScore: event.intAwayScore,
                    date: dateStr,
                    time: timeStr,
                    venue: event.strVenue,
                    timestamp: ts
                });
                resultsCount++;
            } else {
                const fixtureRef = leagueRef.collection('fixtures').doc(event.idEvent);
                fixturesBatch.set(fixtureRef, {
                    eventId: event.idEvent,
                    homeTeam: event.strHomeTeam,
                    awayTeam: event.strAwayTeam,
                    date: dateStr,
                    time: timeStr,
                    venue: event.strVenue,
                    timestamp: ts
                });
                // Ensure stale results (no-score past/resent) are removed
                const resultRef = leagueRef.collection('results').doc(event.idEvent);
                resultsBatch.delete(resultRef);
                fixturesCount++;
            }
        });

        await fixturesBatch.commit();
        await resultsBatch.commit();
        console.log(`Added ${fixturesCount} fixtures and ${resultsCount} results for ${leagueConfig.name}`);

        // Fix any future-dated no-score results that should be fixtures
        await moveFutureNoScoreResultsToFixtures(leagueRef, todayStr);

        // Calculate standings from results (free API only returns top 5)
        console.log(`Calculating standings from results for ${leagueConfig.name}...`);
        const resultsSnapshot = await leagueRef.collection('results').get();
        const standingsArray = buildStandingsFromResults(resultsSnapshot, leagueKey);
        console.log(`Calculated ${standingsArray.length} teams with deductions for ${leagueConfig.name}`);

        if (standingsArray && standingsArray.length > 0) {
            const standingsBatch = db.batch();
            standingsArray.forEach((team, index) => {
                const position = team.position || index + 1;
                const standingRef = leagueRef.collection('standings').doc(`${position}`);
                standingsBatch.set(standingRef, {
                    position,
                    teamName: team.teamName,
                    played: team.played,
                    won: team.won,
                    drawn: team.drawn,
                    lost: team.lost,
                    goalsFor: team.goalsFor,
                    goalsAgainst: team.goalsAgainst,
                    goalDifference: team.goalDifference,
                    points: team.points
                });
            });
            await standingsBatch.commit();
            console.log(`Added ${standingsArray.length} teams to standings for ${leagueConfig.name}`);
        } else {
            console.warn(`No standings were written for ${leagueConfig.name}`);
        }

        console.log(`✓ Updated ${leagueConfig.name}`);
    } catch (error) {
        console.error(`Error updating ${leagueConfig.name}:`, error);
    }
}

exports.updateSportsDataPremierLeague = functions.pubsub.schedule('0,10,20,30,40,50 * * * *').onRun(async () => {
    await updateLeagueData('premier-league');
    return null;
});

exports.updateSportsDataChampionship = functions.pubsub.schedule('1,11,21,31,41,51 * * * *').onRun(async () => {
    await updateLeagueData('championship');
    return null;
});

exports.updateSportsDataLeagueOne = functions.pubsub.schedule('2,12,22,32,42,52 * * * *').onRun(async () => {
    await updateLeagueData('league-one');
    return null;
});

exports.updateSportsDataLeagueTwo = functions.pubsub.schedule('3,13,23,33,43,53 * * * *').onRun(async () => {
    await updateLeagueData('league-two');
    return null;
});

exports.updateSportsDataChampionsLeague = functions.pubsub.schedule('4,14,24,34,44,54 * * * *').onRun(async () => {
    await updateLeagueData('champions-league');
    return null;
});

// On-demand: fetch up to N missing Championship fixtures/results without clearing existing data
exports.fetchChampionshipMissing = functions.https.onCall(async (data, context) => {
    // Admin-only guard
    if (!context.auth || !context.auth.token || !context.auth.token.admin) {
        throw new functions.https.HttpsError('permission-denied', 'Admin authentication required');
    }

    const leagueKey = 'championship';
    const leagueConfig = LEAGUES[leagueKey];
    if (!leagueConfig) {
        throw new functions.https.HttpsError('failed-precondition', 'Championship config missing');
    }

    const maxNew = Math.min(parseInt(data?.maxNew) || 30, 50); // hard cap to avoid long runs
    const startRound = parseInt(data?.startRound) || 1;
    const endRound = parseInt(data?.endRound) || 30;

    console.log(`Fetching up to ${maxNew} missing events for ${leagueConfig.name} (rounds ${startRound}-${endRound})`);

    const leagueRef = db.collection('leagues').doc(leagueKey);

    // Build a set of existing event IDs from fixtures + results
    const existingIds = new Set();
    const [fixturesSnap, resultsSnap] = await Promise.all([
        leagueRef.collection('fixtures').get(),
        leagueRef.collection('results').get()
    ]);
    fixturesSnap.forEach(doc => existingIds.add(doc.id));
    resultsSnap.forEach(doc => existingIds.add(doc.id));
    console.log(`Existing events: fixtures=${fixturesSnap.size}, results=${resultsSnap.size}`);

    const fixturesBatch = db.batch();
    const resultsBatch = db.batch();
    let fixturesCount = 0;
    let resultsCount = 0;

    const now = new Date();

    for (let round = startRound; round <= endRound; round++) {
        if ((fixturesCount + resultsCount) >= maxNew) break;

        const roundData = await querySportsDB(`/eventsround.php?id=${leagueConfig.id}&r=${round}&s=${leagueConfig.season}`);
        if (!roundData || !roundData.events || !roundData.events.length) {
            console.warn(`No data for round ${round} (${leagueConfig.name})`);
            continue;
        }

        console.log(`Round ${round}: ${roundData.events.length} events`);
        for (const event of roundData.events) {
            if (!event || !event.idEvent) continue;
            if (existingIds.has(event.idEvent)) continue;

            const dateStr = event.dateEvent;
            const timeStr = event.strTime || event.strTimeLocal || '15:00:00';
            const ts = new Date(`${dateStr}T${timeStr}Z`);
            const hasScore = event.intHomeScore !== null && event.intAwayScore !== null;
            const isFinished = event.status && event.status.toLowerCase().includes('match finished');
            const isFuture = ts >= now;
            const isResult = hasScore || isFinished;

            if (isResult) {
                const resultRef = leagueRef.collection('results').doc(event.idEvent);
                resultsBatch.set(resultRef, {
                    eventId: event.idEvent,
                    homeTeam: event.strHomeTeam,
                    awayTeam: event.strAwayTeam,
                    homeScore: event.intHomeScore,
                    awayScore: event.intAwayScore,
                    date: dateStr,
                    time: timeStr,
                    venue: event.strVenue,
                    timestamp: ts
                });
                resultsCount++;
            } else {
                const fixtureRef = leagueRef.collection('fixtures').doc(event.idEvent);
                fixturesBatch.set(fixtureRef, {
                    eventId: event.idEvent,
                    homeTeam: event.strHomeTeam,
                    awayTeam: event.strAwayTeam,
                    date: dateStr,
                    time: timeStr,
                    venue: event.strVenue,
                    timestamp: ts
                });
                fixturesCount++;
            }

            existingIds.add(event.idEvent);
            if ((fixturesCount + resultsCount) >= maxNew) break;
        }
    }

    if (fixturesCount > 0) await fixturesBatch.commit();
    if (resultsCount > 0) await resultsBatch.commit();

    console.log(`Added ${fixturesCount} fixtures and ${resultsCount} results for ${leagueConfig.name} (one-off missing fetch)`);

    return {
        fixturesAdded: fixturesCount,
        resultsAdded: resultsCount,
        totalAdded: fixturesCount + resultsCount,
        checkedRounds: `${startRound}-${endRound}`
    };
});

// HTTP variant (shared secret) to fetch missing Championship fixtures/results
exports.fetchChampionshipMissingHttp = functions.https.onRequest(async (req, res) => {
    try {
        const suppliedSecret = req.query.secret || req.headers['x-fetch-secret'];
        if (!FETCH_MISSING_SECRET || suppliedSecret !== FETCH_MISSING_SECRET) {
            res.status(403).send('Forbidden');
            return;
        }

        const leagueKey = 'championship';
        const leagueConfig = LEAGUES[leagueKey];
        if (!leagueConfig) {
            res.status(500).send('Championship config missing');
            return;
        }

        const maxNew = Math.min(parseInt(req.query.maxNew || req.body?.maxNew) || 30, 50);
        const startRound = parseInt(req.query.startRound || req.body?.startRound) || 1;
        const endRound = parseInt(req.query.endRound || req.body?.endRound) || 46;

        console.log(`HTTP fetch: up to ${maxNew} missing events for ${leagueConfig.name} (rounds ${startRound}-${endRound})`);

        const leagueRef = db.collection('leagues').doc(leagueKey);

        // Build set of existing event IDs from fixtures + results
        const existingIds = new Set();
        const [fixturesSnap, resultsSnap] = await Promise.all([
            leagueRef.collection('fixtures').get(),
            leagueRef.collection('results').get()
        ]);
        fixturesSnap.forEach(doc => existingIds.add(doc.id));
        resultsSnap.forEach(doc => existingIds.add(doc.id));
        console.log(`Existing events: fixtures=${fixturesSnap.size}, results=${resultsSnap.size}`);

        const fixturesBatch = db.batch();
        const resultsBatch = db.batch();
        let fixturesCount = 0;
        let resultsCount = 0;
        const now = new Date();

        for (let round = startRound; round <= endRound; round++) {
            if ((fixturesCount + resultsCount) >= maxNew) break;

            const roundData = await querySportsDB(`/eventsround.php?id=${leagueConfig.id}&r=${round}&s=${leagueConfig.season}`);
            if (!roundData || !roundData.events || !roundData.events.length) {
                console.warn(`No data for round ${round} (${leagueConfig.name})`);
                continue;
            }

            console.log(`Round ${round}: ${roundData.events.length} events`);
            for (const event of roundData.events) {
                if (!event || !event.idEvent) continue;
                if (existingIds.has(event.idEvent)) continue;

                const dateStr = event.dateEvent;
                const timeStr = event.strTime || event.strTimeLocal || '15:00:00';
                const ts = new Date(`${dateStr}T${timeStr}Z`);
                const hasScore = event.intHomeScore !== null && event.intAwayScore !== null;
                const isFinished = event.status && event.status.toLowerCase().includes('match finished');
                const isFuture = ts >= now;
                const isResult = hasScore || isFinished;

                if (isResult) {
                    const resultRef = leagueRef.collection('results').doc(event.idEvent);
                    resultsBatch.set(resultRef, {
                        eventId: event.idEvent,
                        homeTeam: event.strHomeTeam,
                        awayTeam: event.strAwayTeam,
                        homeScore: event.intHomeScore,
                        awayScore: event.intAwayScore,
                        date: dateStr,
                        time: timeStr,
                        venue: event.strVenue,
                        timestamp: ts
                    });
                    resultsCount++;
                } else {
                    const fixtureRef = leagueRef.collection('fixtures').doc(event.idEvent);
                    fixturesBatch.set(fixtureRef, {
                        eventId: event.idEvent,
                        homeTeam: event.strHomeTeam,
                        awayTeam: event.strAwayTeam,
                        date: dateStr,
                        time: timeStr,
                        venue: event.strVenue,
                        timestamp: ts
                    });
                    fixturesCount++;
                }

                existingIds.add(event.idEvent);
                if ((fixturesCount + resultsCount) >= maxNew) break;
            }
        }

        if (fixturesCount > 0) await fixturesBatch.commit();
        if (resultsCount > 0) await resultsBatch.commit();

        const payload = {
            fixturesAdded: fixturesCount,
            resultsAdded: resultsCount,
            totalAdded: fixturesCount + resultsCount,
            checkedRounds: `${startRound}-${endRound}`
        };

        console.log(`HTTP fetch added ${fixturesCount} fixtures and ${resultsCount} results for ${leagueConfig.name}`);
        res.json(payload);
    } catch (err) {
        console.error('fetchChampionshipMissingHttp error', err);
        res.status(500).send('Internal error');
    }
});

// HTTP endpoint to rebuild standings from existing results (default: Championship)
exports.rebuildStandingsHttp = functions.https.onRequest(async (req, res) => {
    try {
        const suppliedSecret = req.query.secret || req.headers['x-fetch-secret'];
        if (!FETCH_MISSING_SECRET || suppliedSecret !== FETCH_MISSING_SECRET) {
            res.status(403).send('Forbidden');
            return;
        }

        const leagueKey = req.query.league || req.body?.league || 'championship';
        const leagueConfig = LEAGUES[leagueKey];
        if (!leagueConfig) {
            res.status(400).send('Unknown league');
            return;
        }

        const leagueRef = db.collection('leagues').doc(leagueKey);
        await clearSubcollection(leagueRef, 'standings');

        const resultsSnapshot = await leagueRef.collection('results').get();
        const standingsMap = {};

        resultsSnapshot.forEach(doc => {
            const result = doc.data();
            const { homeTeam, awayTeam, homeScore, awayScore } = result;
            if (homeScore === null || awayScore === null) return;

            const homeGoals = parseInt(homeScore);
            const awayGoals = parseInt(awayScore);
            if (Number.isNaN(homeGoals) || Number.isNaN(awayGoals)) return;

            if (!standingsMap[homeTeam]) {
                standingsMap[homeTeam] = { team: homeTeam, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0 };
            }
            if (!standingsMap[awayTeam]) {
                standingsMap[awayTeam] = { team: awayTeam, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0 };
            }

            standingsMap[homeTeam].played++;
            standingsMap[awayTeam].played++;
            standingsMap[homeTeam].goalsFor += homeGoals;
            standingsMap[homeTeam].goalsAgainst += awayGoals;
            standingsMap[awayTeam].goalsFor += awayGoals;
            standingsMap[awayTeam].goalsAgainst += homeGoals;

            if (homeGoals > awayGoals) {
                standingsMap[homeTeam].won++;
                standingsMap[homeTeam].points += 3;
                standingsMap[awayTeam].lost++;
            } else if (homeGoals < awayGoals) {
                standingsMap[awayTeam].won++;
                standingsMap[awayTeam].points += 3;
                standingsMap[homeTeam].lost++;
            } else {
                standingsMap[homeTeam].drawn++;
                standingsMap[awayTeam].drawn++;
                standingsMap[homeTeam].points += 1;
                standingsMap[awayTeam].points += 1;
            }

            standingsMap[homeTeam].goalDifference = standingsMap[homeTeam].goalsFor - standingsMap[homeTeam].goalsAgainst;
            standingsMap[awayTeam].goalDifference = standingsMap[awayTeam].goalsFor - standingsMap[awayTeam].goalsAgainst;
        });

        const standingsArray = Object.values(standingsMap).sort((a, b) => {
            if (b.points !== a.points) return b.points - a.points;
            if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
            if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
            return a.team.localeCompare(b.team);
        });

        const batch = db.batch();
        standingsArray.forEach((team, index) => {
            const standingRef = leagueRef.collection('standings').doc(`${index + 1}`);
            batch.set(standingRef, {
                position: index + 1,
                teamName: team.team,
                played: team.played,
                won: team.won,
                drawn: team.drawn,
                lost: team.lost,
                goalsFor: team.goalsFor,
                goalsAgainst: team.goalsAgainst,
                goalDifference: team.goalDifference,
                points: team.points
            });
        });

        await batch.commit();

        res.json({ league: leagueConfig.name, teams: standingsArray.length, source: 'results' });
    } catch (err) {
        console.error('rebuildStandingsHttp error', err);
        res.status(500).send('Internal error');
    }
});

// HTTP function to manually trigger sports data update (for testing)
exports.triggerSportsUpdate = functions.https.onCall(async (data, context) => {
    // Only admins can trigger manual updates
    if (!context.auth || !context.auth.token.admin) {
        throw new functions.https.HttpsError('permission-denied', 'Admin access required');
    }

    try {
        for (const leagueKey of Object.keys(LEAGUES)) {
            await updateLeagueData(leagueKey);
        }
        return { success: true, message: 'Sports data updated successfully' };
    } catch (error) {
        console.error('Error in manual update:', error);
        throw new functions.https.HttpsError('internal', 'Failed to update sports data');
    }
});

// HTTP endpoint to manually trigger sports data update via shared secret
exports.triggerSportsUpdateHttp = functions.https.onRequest(async (req, res) => {
    try {
        const suppliedSecret = req.query.secret || req.headers['x-fetch-secret'];
        if (!FETCH_MISSING_SECRET || suppliedSecret !== FETCH_MISSING_SECRET) {
            res.status(403).send('Forbidden');
            return;
        }

        for (const leagueKey of Object.keys(LEAGUES)) {
            await updateLeagueData(leagueKey);
        }
        res.json({ success: true, message: 'Sports data updated successfully' });
    } catch (error) {
        console.error('Error in manual update:', error);
        res.status(500).send('Internal error');
    }
});


/**
 * DEMO DATA SECalculate standings from results (Wikidata doesn't provide pre-computed tables)
            const teamStats = {};
            allEvents.forEach(event => {
                if (event.intHomeScore === null || event.intAwayScore === null) return;
                
                const homeTeam = event.strHomeTeam;
                const awayTeam = event.strAwayTeam;
                const homeScore = event.intHomeScore;
                const awayScore = event.intAwayScore;
                
                if (!teamStats[homeTeam]) {
                    teamStats[homeTeam] = { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 };
                }
                if (!teamStats[awayTeam]) {
                    teamStats[awayTeam] = { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 };
                }
                
                teamStats[homeTeam].played++;
                teamStats[awayTeam].played++;
                teamStats[homeTeam].goalsFor += homeScore;
                teamStats[homeTeam].goalsAgainst += awayScore;
                teamStats[awayTeam].goalsFor += awayScore;
                teamStats[awayTeam].goalsAgainst += homeScore;
                
                if (homeScore > awayScore) {
                    teamStats[homeTeam].won++;
                    teamStats[homeTeam].points += 3;
                    teamStats[awayTeam].lost++;
                } else if (homeScore < awayScore) {
                    teamStats[awayTeam].won++;
                    teamStats[awayTeam].points += 3;
                    teamStats[homeTeam].lost++;
                } else {
                    teamStats[homeTeam].drawn++;
                    teamStats[awayTeam].drawn++;
                    teamStats[homeTeam].points++;
                    teamStats[awayTeam].points++;
                }
            });
            
            // Sort teams by points, then goal difference
            const sortedTeams = Object.entries(teamStats)
                .map(([name, stats]) => ({
                    teamName: name,
                    ...stats,
                    goalDifference: stats.goalsFor - stats.goalsAgainst
                }))
                .sort((a, b) => {
                    if (b.points !== a.points) return b.points - a.points;
                    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
                    return b.goalsFor - a.goalsFor;
                });
            
            if (sortedTeams.length) {
                const standingsBatch = db.batch();
                sortedTeams.forEach((team, index) => {
                    const standingRef = leagueRef.collection('standings').doc(`${index}`);
                    standingsBatch.set(standingRef, {
                        teamId: `${index}`,
                        teamName: team.teamName,
                        position: index + 1,
                        played: team.played,
                        won: team.won,
                        drawn: team.drawn,
                        lost: team.lost,
                        goalsFor: team.goalsFor,
                        goalsAgainst: team.goalsAgainst,
                        goalDifference: team.goalDifference,
                        points: team.points
                    });
                });
                await standingsBatch.commit();
                console.log(`Calculated and stored ${sortedTeams.length} standings` 'Crystal Palace', date: '2026-01-25', time: '15:00:00', venue: 'Portman Road' },
                    { home: 'Brighton', away: 'West Ham', date: '2026-02-01', time: '15:00:00', venue: 'Amex Stadium' },
                    { home: 'Tottenham', away: 'Aston Villa', date: '2026-02-01', time: '15:00:00', venue: 'Tottenham Hotspur Stadium' },
                    { home: 'Chelsea', away: 'Bournemouth', date: '2026-02-02', time: '14:00:00', venue: 'Stamford Bridge' },
                    { home: 'Manchester United', away: 'Leicester', date: '2026-02-02', time: '16:30:00', venue: 'Old Trafford' },
                    { home: 'Liverpool', away: 'Brentford', date: '2026-02-03', time: '20:15:00', venue: 'Anfield' },
                    { home: 'Manchester City', away: 'Nottingham Forest', date: '2026-02-04', time: '19:45:00', venue: 'Etihad Stadium' },
                    { home: 'Fulham', away: 'Chelsea', date: '2026-02-07', time: '15:00:00', venue: 'Craven Cottage' },
                    { home: 'Everton', away: 'Brighton', date: '2026-02-07', time: '15:00:00', venue: 'Goodison Park' },
                    { home: 'Wolverhampton', away: 'Southampton', date: '2026-02-07', time: '15:00:00', venue: 'Molineux Stadium' },
                    { home: 'Newcastle', away: 'Manchester United', date: '2026-02-08', time: '12:30:00', venue: 'St James Park' },
                    { home: 'Arsenal', away: 'Brighton', date: '2026-02-14', time: '15:00:00', venue: 'Emirates Stadium' }
                ],
                results: [
                    { home: 'Manchester City', away: 'Manchester United', homeScore: 1, awayScore: 0, date: '2026-01-14', time: '20:00:00', venue: 'Etihad Stadium' },
                    { home: 'Liverpool', away: 'Chelsea', homeScore: 2, awayScore: 1, date: '2026-01-17', time: '15:00:00', venue: 'Anfield' },
                    { home: 'Tottenham', away: 'West Ham', homeScore: 3, awayScore: 1, date: '2026-01-18', time: '15:00:00', venue: 'Tottenham Hotspur Stadium' },
                    { home: 'Newcastle', away: 'Aston Villa', homeScore: 2, awayScore: 2, date: '2026-01-19', time: '15:00:00', venue: 'St James Park' },
                    { home: 'Arsenal', away: 'Ipswich', homeScore: 2, awayScore: 0, date: '2026-01-20', time: '15:00:00', venue: 'Emirates Stadium' },
                    { home: 'Brighton', away: 'Fulham', homeScore: 1, awayScore: 1, date: '2026-01-21', time: '15:00:00', venue: 'Amex Stadium' },
                    { home: 'Bournemouth', away: 'Southampton', homeScore: 3, awayScore: 0, date: '2026-01-22', time: '15:00:00', venue: 'Vitality Stadium' },
                    { home: 'Nottingham Forest', away: 'Everton', homeScore: 1, awayScore: 1, date: '2026-01-23', time: '15:00:00', venue: 'City Ground' },
                    { home: 'Leicester', away: 'Crystal Palace', homeScore: 2, awayScore: 0, date: '2026-01-24', time: '15:00:00', venue: 'King Power Stadium' },
                    { home: 'Brentford', away: 'Wolverhampton', homeScore: 2, awayScore: 1, date: '2026-01-25', time: '12:30:00', venue: 'Gtech Community Stadium' }
                ]
            },
            'championship': {
                name: 'Championship',
                teams: ['Leeds United', 'West Bromwich Albion', 'Cardiff City', 'Bristol City', 'Coventry City', 'Derby County', 'Preston North End', 'Middlesbrough', 'Plymouth Argyle', 'Stoke City', 'Hull City', 'Portsmouth', 'Norwich City', 'Watford', 'Luton Town', 'Millwall', 'Reading', 'Sunderland', 'Swansea City', 'Blackburn Rovers'],
                fixtures: [
                    { home: 'Leeds United', away: 'West Bromwich Albion', date: '2026-02-01', time: '15:00:00', venue: 'Elland Road' },
                    { home: 'Cardiff City', away: 'Bristol City', date: '2026-02-02', time: '15:00:00', venue: 'Cardiff City Stadium' },
                    { home: 'Coventry City', away: 'Derby County', date: '2026-02-03', time: '15:00:00', venue: 'Coventry City Stadium' },
                    { home: 'Preston North End', away: 'Middlesbrough', date: '2026-02-04', time: '19:45:00', venue: 'Deepdale' },
                    { home: 'Plymouth Argyle', away: 'Stoke City', date: '2026-02-05', time: '15:00:00', venue: 'Home Park' }
                ],
                results: [
                    { home: 'Leeds United', away: 'West Bromwich Albion', homeScore: 1, awayScore: 0, date: '2026-01-20', time: '15:00:00', venue: 'Elland Road' },
                    { home: 'Cardiff City', away: 'Bristol City', homeScore: 2, awayScore: 2, date: '2026-01-21', time: '15:00:00', venue: 'Cardiff City Stadium' },
                    { home: 'Coventry City', away: 'Derby County', homeScore: 3, awayScore: 1, date: '2026-01-22', time: '15:00:00', venue: 'Coventry City Stadium' },
                    { home: 'Preston North End', away: 'Middlesbrough', homeScore: 0, awayScore: 1, date: '2026-01-23', time: '19:45:00', venue: 'Deepdale' },
                    { home: 'Plymouth Argyle', away: 'Stoke City', homeScore: 2, awayScore: 1, date: '2026-01-24', time: '15:00:00', venue: 'Home Park' }
                ]
            },
            'league-one': {
                name: 'League One',
                teams: ['Wrexham', 'Wycombe Wanderers', 'Stockport County', 'Birmingham City', 'Rotherham United', 'Leyton Orient', 'Lincoln City', 'Bolton Wanderers', 'Port Vale', 'Mansfield Town', 'Peterborough United', 'Ipswich Town', 'Cheltenham Town', 'Northampton Town', 'Shrewsbury Town', 'Crawley Town', 'Burton Albion', 'Salford City', 'MK Dons', 'Charlton Athletic'],
                fixtures: [
                    { home: 'Wrexham', away: 'Wycombe Wanderers', date: '2026-02-01', time: '15:00:00', venue: 'Racecourse Ground' },
                    { home: 'Stockport County', away: 'Birmingham City', date: '2026-02-02', time: '15:00:00', venue: 'Edgeley Park' },
                    { home: 'Rotherham United', away: 'Leyton Orient', date: '2026-02-03', time: '19:45:00', venue: 'New York Stadium' }
                ],
                results: [
                    { home: 'Wrexham', away: 'Wycombe Wanderers', homeScore: 1, awayScore: 1, date: '2026-01-22', time: '15:00:00', venue: 'Racecourse Ground' },
                    { home: 'Stockport County', away: 'Birmingham City', homeScore: 2, awayScore: 0, date: '2026-01-23', time: '15:00:00', venue: 'Edgeley Park' },
                    { home: 'Rotherham United', away: 'Leyton Orient', homeScore: 3, awayScore: 2, date: '2026-01-24', time: '19:45:00', venue: 'New York Stadium' }
                ]
            },
            'league-two': {
                name: 'League Two',
                teams: ['Doncaster Rovers', 'Forest Green Rovers', 'Salford City Reserve', 'Swindon Town', 'Grimsby Town', 'Bradford City', 'Harrogate Town', 'Barrow', 'Stevenage', 'Tranmere Rovers', 'Newport County', 'Colchester United', 'Southend United', 'Leyton Orient Reserve', 'Cambridge United', 'Accrington Stanley', 'Hartlepool United', 'Scunthorpe United', 'Crewe Alexandra', 'Exeter City'],
                fixtures: [
                    { home: 'Doncaster Rovers', away: 'Forest Green Rovers', date: '2026-02-01', time: '15:00:00', venue: 'Keepmoat Stadium' },
                    { home: 'Swindon Town', away: 'Grimsby Town', date: '2026-02-02', time: '19:45:00', venue: 'County Ground' }
                ],
                results: [
                    { home: 'Doncaster Rovers', away: 'Forest Green Rovers', homeScore: 2, awayScore: 1, date: '2026-01-24', time: '15:00:00', venue: 'Keepmoat Stadium' },
                    { home: 'Swindon Town', away: 'Grimsby Town', homeScore: 1, awayScore: 1, date: '2026-01-25', time: '19:45:00', venue: 'County Ground' }
                ]
            },
            'champions-league': {
                name: 'Champions League',
                teams: ['Manchester City', 'Real Madrid', 'Bayern Munich', 'PSG', 'Liverpool', 'Barcelona', 'Arsenal', 'AC Milan', 'Inter Milan', 'Juventus', 'Dortmund', 'Atletico Madrid', 'Chelsea', 'Benfica', 'Napoli', 'RB Leipzig', 'Porto', 'Ajax'],
                fixtures: [
                    { home: 'Manchester City', away: 'Real Madrid', date: '2026-02-11', time: '20:00:00', venue: 'Etihad Stadium' },
                    { home: 'Bayern Munich', away: 'PSG', date: '2026-02-12', time: '20:00:00', venue: 'Allianz Arena' },
                    { home: 'Liverpool', away: 'Barcelona', date: '2026-02-13', time: '20:00:00', venue: 'Anfield' },
                    { home: 'Arsenal', away: 'AC Milan', date: '2026-02-14', time: '20:00:00', venue: 'Emirates Stadium' },
                    { home: 'Inter Milan', away: 'Juventus', date: '2026-02-15', time: '20:00:00', venue: 'San Siro' }
                ],
                results: [
                    { home: 'Manchester City', away: 'Real Madrid', homeScore: 1, awayScore: 0, date: '2026-01-15', time: '20:00:00', venue: 'Etihad Stadium' },
                    { home: 'Bayern Munich', away: 'PSG', homeScore: 3, awayScore: 2, date: '2026-01-16', time: '20:00:00', venue: 'Allianz Arena' },
                    { home: 'Liverpool', away: 'Barcelona', homeScore: 2, awayScore: 1, date: '2026-01-17', time: '20:00:00', venue: 'Anfield' },
                    { home: 'Arsenal', away: 'AC Milan', homeScore: 1, awayScore: 1, date: '2026-01-18', time: '20:00:00', venue: 'Emirates Stadium' },
                    { home: 'Inter Milan', away: 'Juventus', homeScore: 2, awayScore: 0, date: '2026-01-19', time: '20:00:00', venue: 'San Siro' }
                ]
            }
        };

        // Seed data for all leagues
        for (const [leagueKey, leagueConfig] of Object.entries(demoData)) {
            console.log(`Seeding ${leagueConfig.name}...`);
            
            const leagueRef = db.collection('leagues').doc(leagueKey);
            
            // Update league metadata
            await leagueRef.set({
                name: leagueConfig.name,
                leagueId: LEAGUES[leagueKey].id,
                season: '2025-2026',
                lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            
            // Seed fixtures
            const fixturesBatch = db.batch();
            leagueConfig.fixtures.forEach((fixture, idx) => {
                const fixtureRef = leagueRef.collection('fixtures').doc(`fixture_${idx}`);
                fixturesBatch.set(fixtureRef, {
                    eventId: `fixture_${leagueKey}_${idx}`,
                    homeTeam: fixture.home,
                    awayTeam: fixture.away,
                    date: fixture.date,
                    time: fixture.time,
                    venue: fixture.venue,
                    timestamp: new Date(fixture.date + 'T' + fixture.time)
                });
            });
            await fixturesBatch.commit();
            
            // Seed results
            const resultsBatch = db.batch();
            leagueConfig.results.forEach((result, idx) => {
                const resultRef = leagueRef.collection('results').doc(`result_${idx}`);
                resultsBatch.set(resultRef, {
                    eventId: `result_${leagueKey}_${idx}`,
                    homeTeam: result.home,
                    awayTeam: result.away,
                    homeScore: result.homeScore,
                    awayScore: result.awayScore,
                    date: result.date,
                    time: result.time,
                    venue: result.venue,
                    timestamp: new Date(result.date + 'T' + result.time)
                });
            });
            await resultsBatch.commit();
            
            // Seed standings (all teams with demo stats)
            const standingsBatch = db.batch();
            leagueConfig.teams.forEach((teamName, idx) => {
                const position = idx + 1;
                const played = 28 + Math.floor(Math.random() * 4);
                const won = Math.floor(Math.random() * (played - 5));
                const lost = Math.floor(Math.random() * (played - won - 2));
                const drawn = played - won - lost;
                const goalsFor = won * 2 + drawn + Math.floor(Math.random() * 5);
                const goalsAgainst = lost + drawn + Math.floor(Math.random() * 5);
                const points = won * 3 + drawn;
                
                const standingRef = leagueRef.collection('standings').doc(`team_${idx}`);
                standingsBatch.set(standingRef, {
                    teamId: `team_${leagueKey}_${idx}`,
                    teamName: teamName,
                    position: position,
                    played: played,
                    won: won,
                    drawn: drawn,
                    lost: lost,
                    goalsFor: goalsFor,
                    goalsAgainst: goalsAgainst,
                    goalDifference: goalsFor - goalsAgainst,
                    points: points
                });
            });
            await standingsBatch.commit();
            
            console.log(`✓ Seeded ${leagueConfig.name} (${leagueConfig.fixtures.length} fixtures, ${leagueConfig.results.length} results, ${leagueConfig.teams.length} standings)`);
        }
        
        return { success: true, message: 'Demo fixtures seeded successfully' };
    } catch (error) {
        console.error('Error seeding demo fixtures:', error);
        throw new functions.https.HttpsError('internal', 'Failed to seed demo data: ' + error.message);
    }
});

/** * Legacy enterDraw function - kept for backward compatibility
 * Can be removed once all clients migrate to joinTournament
 */
// TODO: Remove this after full migration to tournament system

function isValidPushToken(token) {
    return typeof token === 'string' && token.length >= 100 && token.length <= 4096;
}

async function getUsersWithPushTokensByTeams(teamNames) {
    const uniqueTeams = [...new Set((teamNames || []).filter(Boolean))];
    if (uniqueTeams.length === 0) {
        return { userIds: [], tokenToUserId: {}, tokens: [] };
    }

    const assignmentsSnap = await db.collection('teamAssignments')
        .where('status', '==', 'active')
        .where('team', 'in', uniqueTeams.slice(0, 10))
        .get();

    const userIds = [...new Set(assignmentsSnap.docs.map((doc) => doc.data().userId).filter(Boolean))];
    if (userIds.length === 0) {
        return { userIds: [], tokenToUserId: {}, tokens: [] };
    }

    const tokenToUserId = {};
    const allTokens = [];

    const userDocs = await Promise.all(userIds.map((userId) => db.collection('users').doc(userId).get()));
    userDocs.forEach((userDoc) => {
        if (!userDoc.exists) {
            return;
        }

        const userData = userDoc.data() || {};
        const pushTokens = Array.isArray(userData.pushTokens) ? userData.pushTokens.filter(isValidPushToken) : [];
        pushTokens.forEach((token) => {
            tokenToUserId[token] = userDoc.id;
            allTokens.push(token);
        });
    });

    return {
        userIds,
        tokenToUserId,
        tokens: [...new Set(allTokens)]
    };
}

async function removeInvalidPushTokens(tokenToUserId, invalidTokens) {
    if (!invalidTokens || invalidTokens.length === 0) {
        return;
    }

    const updatesByUser = {};
    invalidTokens.forEach((token) => {
        const userId = tokenToUserId[token];
        if (!userId) {
            return;
        }

        if (!updatesByUser[userId]) {
            updatesByUser[userId] = [];
        }
        updatesByUser[userId].push(token);
    });

    const updatePromises = Object.entries(updatesByUser).map(([userId, tokens]) => {
        const update = {
            pushTokens: admin.firestore.FieldValue.arrayRemove(...tokens)
        };

        return db.collection('users').doc(userId).set(update, { merge: true });
    });

    await Promise.all(updatePromises);
}

async function sendTeamNotification({
    teams,
    title,
    body,
    link,
    data = {}
}) {
    const { tokenToUserId, tokens } = await getUsersWithPushTokensByTeams(teams);
    if (tokens.length === 0) {
        return { sentCount: 0 };
    }

    const response = await admin.messaging().sendEachForMulticast({
        tokens,
        notification: {
            title,
            body
        },
        data: {
            ...Object.entries(data).reduce((acc, [key, value]) => {
                if (value !== undefined && value !== null) {
                    acc[key] = String(value);
                }
                return acc;
            }, {}),
            link: link || '/fixtures.html'
        },
        webpush: {
            fcmOptions: {
                link: link || '/fixtures.html'
            }
        }
    });

    const invalidTokens = [];
    response.responses.forEach((result, index) => {
        if (result.success) {
            return;
        }

        const errorCode = result.error && result.error.code;
        if (errorCode === 'messaging/registration-token-not-registered' || errorCode === 'messaging/invalid-registration-token') {
            invalidTokens.push(tokens[index]);
        }
    });

    await removeInvalidPushTokens(tokenToUserId, invalidTokens);
    return { sentCount: response.successCount };
}

exports.savePushToken = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const token = data && data.token;
    if (!isValidPushToken(token)) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid push token format');
    }

    const userId = context.auth.uid;
    const update = {
        pushTokens: admin.firestore.FieldValue.arrayUnion(token),
        pushTokenUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        pushTokenMeta: {
            platform: (data && data.platform) || 'web',
            userAgent: (data && data.userAgent) || 'unknown'
        }
    };

    await db.collection('users').doc(userId).set(update, { merge: true });
    return { success: true };
});

exports.notifyFixtureCreated = functions.firestore
    .document('leagues/{leagueId}/fixtures/{fixtureId}')
    .onCreate(async (snapshot, context) => {
        const fixture = snapshot.data() || {};
        const homeTeam = fixture.homeTeam;
        const awayTeam = fixture.awayTeam;

        if (!homeTeam || !awayTeam) {
            return null;
        }

        const datePart = fixture.date ? ` · ${fixture.date}` : '';
        const timePart = fixture.time ? ` ${fixture.time}` : '';

        await sendTeamNotification({
            teams: [homeTeam, awayTeam],
            title: `Upcoming: ${homeTeam} vs ${awayTeam}`,
            body: `New fixture added${datePart}${timePart}`,
            link: '/fixtures.html',
            data: {
                type: 'fixture',
                leagueId: context.params.leagueId,
                fixtureId: context.params.fixtureId,
                homeTeam,
                awayTeam
            }
        });

        return null;
    });

exports.notifyResultUpdated = functions.firestore
    .document('leagues/{leagueId}/results/{resultId}')
    .onWrite(async (change, context) => {
        if (!change.after.exists) {
            return null;
        }

        const after = change.after.data() || {};
        const before = change.before.exists ? (change.before.data() || {}) : null;

        const homeTeam = after.homeTeam;
        const awayTeam = after.awayTeam;
        const hasScore = Number.isFinite(after.homeScore) && Number.isFinite(after.awayScore);

        if (!homeTeam || !awayTeam || !hasScore) {
            return null;
        }

        const scoreChanged = !before || before.homeScore !== after.homeScore || before.awayScore !== after.awayScore;
        if (!scoreChanged) {
            return null;
        }

        await sendTeamNotification({
            teams: [homeTeam, awayTeam],
            title: `Result: ${homeTeam} ${after.homeScore}-${after.awayScore} ${awayTeam}`,
            body: 'Your team match result is in.',
            link: '/fixtures.html',
            data: {
                type: 'result',
                leagueId: context.params.leagueId,
                resultId: context.params.resultId,
                homeTeam,
                awayTeam,
                homeScore: after.homeScore,
                awayScore: after.awayScore
            }
        });

        return null;
    });


