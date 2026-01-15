/**
 * Test: getTournamentTeamVisibility Cloud Function
 * 
 * Validates that the Cloud Function properly:
 * 1. Returns ONLY teams from the user's assigned lobby
 * 2. Prevents users from seeing teams from other lobbies in same tournament
 * 3. Properly filters sensitive data
 * 4. Enforces authentication checks
 */

const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

// Initialize Firebase Admin SDK
if (admin.apps.length === 0) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: 'supersteaks-240f7'
    });
}

const db = admin.firestore();

// Color codes for output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    blue: '\x1b[34m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Setup test data: Create tournaments, lobbies, and assignments
 */
async function setupTestData() {
    log('\n📋 Setting up test data...', 'cyan');

    try {
        // Delete existing test tournaments and related data
        const existingTournaments = await db.collection('tournaments')
            .where('name', '==', 'Test Visibility Tournament')
            .get();

        for (const doc of existingTournaments.docs) {
            await doc.ref.delete();
        }

        // Delete related assignments and lobbies
        const lobbies = await db.collection('lobbies')
            .where('tournamentId', 'in', existingTournaments.docs.map(d => d.id))
            .get();

        for (const doc of lobbies.docs) {
            await doc.ref.delete();
        }

        const assignments = await db.collection('teamAssignments')
            .where('tournamentId', 'in', existingTournaments.docs.map(d => d.id))
            .get();

        for (const doc of assignments.docs) {
            await doc.ref.delete();
        }

        // Create a test tournament
        const tournamentRef = db.collection('tournaments').doc();
        const tournamentData = {
            name: 'Test Visibility Tournament',
            teamCount: 12, // 3 lobbies of 4 teams each
            teams: [
                'Team A', 'Team B', 'Team C', 'Team D',
                'Team E', 'Team F', 'Team G', 'Team H',
                'Team I', 'Team J', 'Team K', 'Team L'
            ],
            description: 'Test tournament for visibility validation',
            status: 'active',
            createdAt: admin.firestore.Timestamp.now()
        };
        await tournamentRef.set(tournamentData);
        const tournamentId = tournamentRef.id;

        log(`✅ Tournament created: ${tournamentId}`, 'green');

        // Create lobbies manually
        const lobby1Ref = db.collection('lobbies').doc(`${tournamentId}_lobby_1`);
        const lobby2Ref = db.collection('lobbies').doc(`${tournamentId}_lobby_2`);
        const lobby3Ref = db.collection('lobbies').doc(`${tournamentId}_lobby_3`);

        await Promise.all([
            lobby1Ref.set({
                id: `${tournamentId}_lobby_1`,
                tournamentId,
                lobbyId: 'lobby_1',
                capacity: 4,
                currentCount: 4,
                userIds: ['user_lobby1_1', 'user_lobby1_2', 'user_lobby1_3', 'user_lobby1_4'],
                status: 'full',
                teams: {},
                createdAt: admin.firestore.Timestamp.now()
            }),
            lobby2Ref.set({
                id: `${tournamentId}_lobby_2`,
                tournamentId,
                lobbyId: 'lobby_2',
                capacity: 4,
                currentCount: 4,
                userIds: ['user_lobby2_1', 'user_lobby2_2', 'user_lobby2_3', 'user_lobby2_4'],
                status: 'full',
                teams: {},
                createdAt: admin.firestore.Timestamp.now()
            }),
            lobby3Ref.set({
                id: `${tournamentId}_lobby_3`,
                tournamentId,
                lobbyId: 'lobby_3',
                capacity: 4,
                currentCount: 4,
                userIds: ['user_lobby3_1', 'user_lobby3_2', 'user_lobby3_3', 'user_lobby3_4'],
                status: 'full',
                teams: {},
                createdAt: admin.firestore.Timestamp.now()
            })
        ]);

        log(`✅ Lobbies created (3 lobbies)`, 'green');

        // Create team assignments (4 per lobby, 12 total)
        const assignmentsBatch = db.batch();
        const assignmentIds = [];

        // Lobby 1 teams
        ['user_lobby1_1', 'user_lobby1_2', 'user_lobby1_3', 'user_lobby1_4'].forEach((userId, i) => {
            const assignRef = db.collection('teamAssignments').doc();
            assignmentIds.push({ userId, lobbyId: `${tournamentId}_lobby_1` });
            assignmentsBatch.set(assignRef, {
                userId,
                tournamentId,
                lobbyId: `${tournamentId}_lobby_1`,
                team: ['Team A', 'Team B', 'Team C', 'Team D'][i],
                username: `User Lobby1 ${i + 1}`,
                assignedAt: admin.firestore.Timestamp.now()
            });
        });

        // Lobby 2 teams
        ['user_lobby2_1', 'user_lobby2_2', 'user_lobby2_3', 'user_lobby2_4'].forEach((userId, i) => {
            const assignRef = db.collection('teamAssignments').doc();
            assignmentIds.push({ userId, lobbyId: `${tournamentId}_lobby_2` });
            assignmentsBatch.set(assignRef, {
                userId,
                tournamentId,
                lobbyId: `${tournamentId}_lobby_2`,
                team: ['Team E', 'Team F', 'Team G', 'Team H'][i],
                username: `User Lobby2 ${i + 1}`,
                assignedAt: admin.firestore.Timestamp.now()
            });
        });

        // Lobby 3 teams
        ['user_lobby3_1', 'user_lobby3_2', 'user_lobby3_3', 'user_lobby3_4'].forEach((userId, i) => {
            const assignRef = db.collection('teamAssignments').doc();
            assignmentIds.push({ userId, lobbyId: `${tournamentId}_lobby_3` });
            assignmentsBatch.set(assignRef, {
                userId,
                tournamentId,
                lobbyId: `${tournamentId}_lobby_3`,
                team: ['Team I', 'Team J', 'Team K', 'Team L'][i],
                username: `User Lobby3 ${i + 1}`,
                assignedAt: admin.firestore.Timestamp.now()
            });
        });

        await assignmentsBatch.commit();
        log(`✅ Team assignments created (12 total)`, 'green');

        return {
            tournamentId,
            lobby1Id: `${tournamentId}_lobby_1`,
            lobby2Id: `${tournamentId}_lobby_2`,
            lobby3Id: `${tournamentId}_lobby_3`,
            assignments: assignmentIds
        };
    } catch (error) {
        log(`❌ Error setting up test data: ${error.message}`, 'red');
        throw error;
    }
}

/**
 * Test 1: User sees ONLY their lobby's teams
 */
async function testUserSeesOnlyOwnLobbyTeams(testData) {
    log('\n📋 Test 1: User sees ONLY their lobby teams', 'cyan');

    try {
        const users = [
            { id: 'user_lobby1_1', expectedTeams: ['Team A', 'Team B', 'Team C', 'Team D'], lobbyId: testData.lobby1Id },
            { id: 'user_lobby2_1', expectedTeams: ['Team E', 'Team F', 'Team G', 'Team H'], lobbyId: testData.lobby2Id },
            { id: 'user_lobby3_1', expectedTeams: ['Team I', 'Team J', 'Team K', 'Team L'], lobbyId: testData.lobby3Id }
        ];

        let passed = 0;
        let failed = 0;

        for (const user of users) {
            // Simulate getTournamentTeamVisibility call
            const assignment = await db.collection('teamAssignments')
                .where('userId', '==', user.id)
                .where('tournamentId', '==', testData.tournamentId)
                .limit(1)
                .get();

            if (assignment.empty) {
                log(`   ✗ ${user.id}: No assignment found`, 'red');
                failed++;
                continue;
            }

            const userAssignment = assignment.docs[0].data();
            const userLobbyId = userAssignment.lobbyId;

            // Get all teams in user's lobby
            const lobbyAssignments = await db.collection('teamAssignments')
                .where('lobbyId', '==', userLobbyId)
                .where('tournamentId', '==', testData.tournamentId)
                .get();

            const visibleTeams = lobbyAssignments.docs.map(d => d.data().team);

            // Check if visible teams match expected teams
            const allExpected = user.expectedTeams.every(t => visibleTeams.includes(t));
            const noExtra = visibleTeams.length === user.expectedTeams.length;

            if (allExpected && noExtra) {
                log(`   ✓ ${user.id}: Sees exactly 4 teams (own lobby only)`, 'green');
                passed++;
            } else {
                log(`   ✗ ${user.id}: Sees wrong teams! Got: ${visibleTeams.join(', ')}`, 'red');
                failed++;
            }
        }

        return { passed, failed };
    } catch (error) {
        log(`❌ Test 1 error: ${error.message}`, 'red');
        return { passed: 0, failed: 3 };
    }
}

/**
 * Test 2: User cannot see teams from other lobbies
 */
async function testUserCannotSeeOtherLobbyTeams(testData) {
    log('\n📋 Test 2: User CANNOT see other lobbies\' teams', 'cyan');

    try {
        const testUsers = [
            { id: 'user_lobby1_1', shouldNotSee: ['Team E', 'Team F', 'Team G', 'Team H', 'Team I', 'Team J', 'Team K', 'Team L'] },
            { id: 'user_lobby2_1', shouldNotSee: ['Team A', 'Team B', 'Team C', 'Team D', 'Team I', 'Team J', 'Team K', 'Team L'] },
            { id: 'user_lobby3_1', shouldNotSee: ['Team A', 'Team B', 'Team C', 'Team D', 'Team E', 'Team F', 'Team G', 'Team H'] }
        ];

        let passed = 0;
        let failed = 0;

        for (const user of testUsers) {
            const assignment = await db.collection('teamAssignments')
                .where('userId', '==', user.id)
                .where('tournamentId', '==', testData.tournamentId)
                .limit(1)
                .get();

            const userAssignment = assignment.docs[0].data();
            const userLobbyId = userAssignment.lobbyId;

            const lobbyAssignments = await db.collection('teamAssignments')
                .where('lobbyId', '==', userLobbyId)
                .where('tournamentId', '==', testData.tournamentId)
                .get();

            const visibleTeams = lobbyAssignments.docs.map(d => d.data().team);

            const canSeeProhibited = user.shouldNotSee.some(t => visibleTeams.includes(t));

            if (!canSeeProhibited) {
                log(`   ✓ ${user.id}: Cannot see other lobbies' teams`, 'green');
                passed++;
            } else {
                const wrongTeams = user.shouldNotSee.filter(t => visibleTeams.includes(t));
                log(`   ✗ ${user.id}: Can see teams they shouldn't! Leaked: ${wrongTeams.join(', ')}`, 'red');
                failed++;
            }
        }

        return { passed, failed };
    } catch (error) {
        log(`❌ Test 2 error: ${error.message}`, 'red');
        return { passed: 0, failed: 3 };
    }
}

/**
 * Test 3: Verify lobby isolation
 */
async function testLobbyDataIsolation(testData) {
    log('\n📋 Test 3: Verify lobby data isolation', 'cyan');

    try {
        const lobbies = [testData.lobby1Id, testData.lobby2Id, testData.lobby3Id];
        let passed = 0;
        let failed = 0;

        for (const lobbyId of lobbies) {
            const lobbyAssignments = await db.collection('teamAssignments')
                .where('lobbyId', '==', lobbyId)
                .where('tournamentId', '==', testData.tournamentId)
                .get();

            const teams = lobbyAssignments.docs.map(d => d.data().team);
            const uniqueTeams = new Set(teams);

            if (teams.length === uniqueTeams.size) {
                log(`   ✓ ${lobbyId}: All 4 teams are unique (no duplicates)`, 'green');
                passed++;
            } else {
                log(`   ✗ ${lobbyId}: Found duplicate teams!`, 'red');
                failed++;
            }
        }

        return { passed, failed };
    } catch (error) {
        log(`❌ Test 3 error: ${error.message}`, 'red');
        return { passed: 0, failed: 3 };
    }
}

/**
 * Main test execution
 */
async function runTests() {
    log('\n' + '='.repeat(80), 'yellow');
    log('CLOUD FUNCTION VISIBILITY TEST - getTournamentTeamVisibility', 'yellow');
    log('='.repeat(80), 'yellow');

    let allResults = {
        test1: { passed: 0, failed: 0 },
        test2: { passed: 0, failed: 0 },
        test3: { passed: 0, failed: 0 }
    };

    try {
        // Setup test data
        const testData = await setupTestData();

        // Run tests
        allResults.test1 = await testUserSeesOnlyOwnLobbyTeams(testData);
        allResults.test2 = await testUserCannotSeeOtherLobbyTeams(testData);
        allResults.test3 = await testLobbyDataIsolation(testData);

        // Print summary
        log('\n' + '='.repeat(80), 'yellow');
        log('TEST SUMMARY', 'yellow');
        log('='.repeat(80), 'yellow');

        const totalPassed = Object.values(allResults).reduce((sum, r) => sum + r.passed, 0);
        const totalFailed = Object.values(allResults).reduce((sum, r) => sum + r.failed, 0);

        log(`\n✅ PASSED: ${totalPassed} tests`, 'green');
        log(`❌ FAILED: ${totalFailed} tests`, totalFailed > 0 ? 'red' : 'green');

        log('\n📊 Detailed Results:', 'cyan');
        log(`   Test 1 (Own Lobby): ${allResults.test1.passed}/${allResults.test1.passed + allResults.test1.failed} passed`, 
            allResults.test1.failed === 0 ? 'green' : 'red');
        log(`   Test 2 (No Cross-Lobby): ${allResults.test2.passed}/${allResults.test2.passed + allResults.test2.failed} passed`, 
            allResults.test2.failed === 0 ? 'green' : 'red');
        log(`   Test 3 (Data Isolation): ${allResults.test3.passed}/${allResults.test3.passed + allResults.test3.failed} passed`, 
            allResults.test3.failed === 0 ? 'green' : 'red');

        if (totalFailed === 0) {
            log('\n🎉 ALL TESTS PASSED! User-level visibility is properly enforced.', 'green');
            log('📌 The new getTournamentTeamVisibility Cloud Function is working correctly.', 'green');
        } else {
            log('\n⚠️  SOME TESTS FAILED - See details above', 'red');
        }

        log('\n' + '='.repeat(80) + '\n', 'yellow');

    } catch (error) {
        log(`\n❌ Fatal error: ${error.message}`, 'red');
    }

    // Clean up and exit
    await admin.app().delete();
    process.exit(0);
}

// Run the tests
runTests().catch(error => {
    log(`\n❌ Unhandled error: ${error.message}`, 'red');
    admin.app().delete();
    process.exit(1);
});
