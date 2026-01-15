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

/** * Legacy enterDraw function - kept for backward compatibility
 * Can be removed once all clients migrate to joinTournament
 */
// TODO: Remove this after full migration to tournament system

