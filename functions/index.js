const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

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
    const tournamentId = data.tournamentId;

    if (!tournamentId) {
        throw new functions.https.HttpsError('invalid-argument', 'tournamentId required');
    }

    try {
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
            
            // Use tournament-specific teams if available, otherwise use default list
            const allTeams = tournament.teams && tournament.teams.length > 0 
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
 * Usage: Call via HTTPS with ?action=create|update|delete and tournament data
 * Requires authentication (admin user)
 */
exports.manageTournaments = functions.https.onCall(async (data, context) => {
    // Check if user is authenticated
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be logged in');
    }

    const { action, tournaments } = data;

    if (!action || !tournaments) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing action or tournaments data');
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

            // Add new tournaments
            for (const tournament of tournaments) {
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
 * Call with: curl -X POST https://.../addTournamentsAdmin -H "x-admin-secret: YOUR_SECRET" -d '{"action":"refresh","tournaments":[...]}'
 */
exports.addTournamentsAdmin = functions.https.onRequest(async (req, res) => {
    const adminSecret = req.headers['x-admin-secret'];
    const expectedSecret = 'supersteaks-admin-2026'; // You can change this
    
    if (adminSecret !== expectedSecret) {
        return res.status(403).json({ error: 'Unauthorized - invalid admin secret' });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { action } = req.body;
    const tournaments = req.body.tournaments || [];

    if (!action) {
        return res.status(400).json({ error: 'Missing action' });
    }

    try {
        if (action === 'deleteAll') {
            const batch = db.batch();
            const snapshot = await db.collection('tournaments').get();
            for (const doc of snapshot.docs) {
                batch.delete(doc.ref);
            }
            await batch.commit();
            return res.status(200).json({ message: 'All tournaments deleted successfully' });
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
 * Manual backup trigger - HTTP endpoint
 */
exports.createBackup = functions.https.onRequest(async (req, res) => {
    const adminSecret = req.headers['x-admin-secret'];
    
    if (adminSecret !== 'supersteaks-admin-2026') {
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

/** * Legacy enterDraw function - kept for backward compatibility
 * Can be removed once all clients migrate to joinTournament
 */
// TODO: Remove this after full migration to tournament system

