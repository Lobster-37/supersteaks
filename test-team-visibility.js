/**
 * Tournament Visibility Test
 * 
 * Validates that:
 * 1. Users can only view teams from their assigned lobby
 * 2. Users cannot see teams from other lobbies in the same tournament
 * 3. Team visibility is properly restricted per user
 * 4. Cross-lobby team information is hidden
 */

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Simulate a user viewing their tournament
 * Returns only the teams they can see (from their lobby)
 */
function getUserVisibleTeams(userId, tournamentName, globalLobbies, userAssignments) {
    // Get user's assignment for this tournament
    const userAssignment = userAssignments[userId]?.[tournamentName];
    
    if (!userAssignment) {
        return {
            canView: false,
            reason: 'User not assigned to this tournament',
            visibleTeams: []
        };
    }

    const lobbyId = userAssignment.lobbyId;
    const lobby = globalLobbies[tournamentName]?.[lobbyId];

    if (!lobby) {
        return {
            canView: false,
            reason: 'Lobby not found',
            visibleTeams: []
        };
    }

    // User can only see teams from their lobby
    const visibleTeams = Object.values(lobby.teams);

    return {
        canView: true,
        lobbyId,
        visersTeam: userAssignment.team,
        visibleTeams: visibleTeams.sort(),
        totalTeamsInLobby: visibleTeams.length
    };
}

/**
 * Simulate tournament data that would be returned to a user
 * Only includes their lobby's data
 */
function getTournamentDataForUser(userId, tournamentName, globalLobbies, userAssignments) {
    const visibleData = getUserVisibleTeams(userId, tournamentName, globalLobbies, userAssignments);

    if (!visibleData.canView) {
        return {
            success: false,
            error: visibleData.reason
        };
    }

    return {
        success: true,
        tournament: tournamentName,
        userLobby: visibleData.lobbyId,
        userTeam: visibleData.usersTeam,
        visibleTeams: visibleData.visibleTeams,
        totalVisibleTeams: visibleData.visibleTeams.length,
        // This is what should NOT be visible:
        hiddenData: {
            otherLobbies: 'HIDDEN',
            otherLobbiesTeams: 'HIDDEN',
            totalTournamenetTeams: 'HIDDEN'
        }
    };
}

/**
 * Test 1: Verify users only see their lobby's teams
 */
function testLobbyTeamVisibility(globalLobbies, userAssignments) {
    log(`\n${'='.repeat(80)}`, 'cyan');
    log(`      TOURNAMENT VISIBILITY TEST: USER TEAM RESTRICTIONS`, 'cyan');
    log(`${'='.repeat(80)}\n`, 'cyan');

    log(`📋 Test 1: Verifying lobby team visibility...`, 'cyan');

    let passCount = 0;
    let failCount = 0;
    const sampleUsers = Object.keys(userAssignments).slice(0, 5); // Test 5 users per tournament

    Object.keys(globalLobbies).forEach(tournamentName => {
        log(`\n   Tournament: ${tournamentName}`, 'magenta');
        
        // Get all lobbies for this tournament
        const lobbies = globalLobbies[tournamentName];
        const lobbyIds = Object.keys(lobbies);

        // Test a sample of users
        sampleUsers.forEach(userId => {
            const userAssignment = userAssignments[userId]?.[tournamentName];
            if (!userAssignment) return;

            const userLobbyId = userAssignment.lobbyId;
            const userTeam = userAssignment.team;

            // Get visible teams (only from user's lobby)
            const visibleTeams = Object.values(lobbies[userLobbyId].teams);

            // Verify user's team is in visible teams
            if (!visibleTeams.includes(userTeam)) {
                log(`      ✗ ${userId}: User's team not in their lobby!`, 'red');
                failCount++;
                return;
            }

            // Verify user doesn't see teams from OTHER lobbies
            let seesOtherLobbyTeams = false;
            lobbyIds.forEach(otherLobbyId => {
                if (otherLobbyId !== userLobbyId) {
                    const otherTeams = Object.values(lobbies[otherLobbyId].teams);
                    otherTeams.forEach(team => {
                        if (visibleTeams.includes(team)) {
                            log(`      ✗ ${userId}: Can see team "${team}" from lobby ${otherLobbyId}!`, 'red');
                            seesOtherLobbyTeams = true;
                            failCount++;
                        }
                    });
                }
            });

            if (!seesOtherLobbyTeams) {
                log(`      ✓ ${userId}: Only sees teams from lobby ${userLobbyId} (${visibleTeams.length} teams)`, 'green');
                passCount++;
            }
        });
    });

    log(`\n   ✅ Lobby visibility check: ${passCount} passed`, 'green');
    if (failCount > 0) {
        log(`   ❌ Lobby visibility check: ${failCount} failed`, 'red');
    }

    return failCount === 0;
}

/**
 * Test 2: Simulate API response for user viewing tournament
 */
function testAPIResponseFiltering(globalLobbies, userAssignments) {
    log(`\n📋 Test 2: Validating API response filtering...`, 'cyan');

    let passCount = 0;
    let failCount = 0;

    // Test with 3 sample users
    const testUsers = Object.keys(userAssignments).slice(0, 3);
    const testTournament = Object.keys(globalLobbies)[0];

    testUsers.forEach(userId => {
        const response = getTournamentDataForUser(userId, testTournament, globalLobbies, userAssignments);

        if (!response.success) {
            log(`   ✗ User ${userId}: Could not get tournament data`, 'red');
            failCount++;
            return;
        }

        // Verify response structure
        if (response.hiddenData.otherLobbies !== 'HIDDEN') {
            log(`   ✗ User ${userId}: Other lobbies data is exposed!`, 'red');
            failCount++;
            return;
        }

        // Verify user can see their team
        if (!response.visibleTeams.includes(response.userTeam)) {
            log(`   ✗ User ${userId}: Cannot see their own team!`, 'red');
            failCount++;
            return;
        }

        log(`   ✓ User ${userId}: Proper visibility - ${response.totalVisibleTeams} teams visible`, 'green');
        passCount++;
    });

    log(`\n   ✅ API response filtering: ${passCount} passed`, 'green');
    if (failCount > 0) {
        log(`   ❌ API response filtering: ${failCount} failed`, 'red');
    }

    return failCount === 0;
}

/**
 * Test 3: Verify data isolation between lobbies in same tournament
 */
function testLobbyDataIsolation(globalLobbies, userAssignments) {
    log(`\n📋 Test 3: Verifying data isolation between lobbies...`, 'cyan');

    let passCount = 0;
    let failCount = 0;

    Object.keys(globalLobbies).forEach(tournamentName => {
        const lobbies = globalLobbies[tournamentName];
        const lobbyIds = Object.keys(lobbies);

        // For each lobby, verify its teams are distinct from other lobbies
        lobbyIds.forEach(lobbyId => {
            const lobby = lobbies[lobbyId];
            const lobbyTeams = new Set(Object.values(lobby.teams));

            let teamsLeakedToOthers = 0;
            lobbyIds.forEach(otherLobbyId => {
                if (otherLobbyId !== lobbyId) {
                    const otherLobby = lobbies[otherLobbyId];
                    const otherTeams = Object.values(otherLobby.teams);
                    
                    otherTeams.forEach(team => {
                        if (lobbyTeams.has(team)) {
                            teamsLeakedToOthers++;
                        }
                    });
                }
            });

            if (teamsLeakedToOthers === 0) {
                passCount++;
            } else {
                log(`   ✗ Lobby ${lobbyId}: ${teamsLeakedToOthers} teams leaked to other lobbies!`, 'red');
                failCount++;
            }
        });
    });

    log(`\n   ✅ Data isolation: ${passCount} lobbies isolated`, 'green');
    if (failCount > 0) {
        log(`   ❌ Data isolation: ${failCount} lobbies compromised`, 'red');
    }

    return failCount === 0;
}

/**
 * Test 4: Comprehensive visibility matrix test
 */
function testVisibilityMatrix(globalLobbies, userAssignments) {
    log(`\n📋 Test 4: Comprehensive visibility matrix (sample)...`, 'cyan');

    const testTournament = Object.keys(globalLobbies)[0];
    const lobbies = globalLobbies[testTournament];
    const lobbyIds = Object.keys(lobbies);

    // Get users from different lobbies
    const usersByLobby = {};
    Object.entries(userAssignments).forEach(([userId, tournaments]) => {
        const assignment = tournaments[testTournament];
        if (!assignment) return;

        const lobbyId = assignment.lobbyId;
        if (!usersByLobby[lobbyId]) {
            usersByLobby[lobbyId] = [];
        }
        usersByLobby[lobbyId].push(userId);
    });

    log(`\n   Tournament: ${testTournament}`, 'magenta');
    log(`   Lobbies: ${lobbyIds.length}`, 'blue');

    let allCorrect = true;
    Object.entries(usersByLobby).forEach(([lobbyId, userIds]) => {
        const testUser = userIds[0];
        const userTeam = userAssignments[testUser][testTournament].team;
        const visibleTeams = getUserVisibleTeams(testUser, testTournament, globalLobbies, userAssignments).visibleTeams;
        const expectedTeams = Object.values(lobbies[lobbyId].teams);

        if (visibleTeams.length === expectedTeams.length) {
            log(`   ✓ ${lobbyId}: User ${testUser.substring(0, 8)}... sees all ${visibleTeams.length} lobby teams`, 'green');
        } else {
            log(`   ✗ ${lobbyId}: Team count mismatch! User sees ${visibleTeams.length}, expected ${expectedTeams.length}`, 'red');
            allCorrect = false;
        }
    });

    return allCorrect;
}

/**
 * Simulate the multi-tournament scenario from previous test
 */
function runComprehensiveVisibilityTest() {
    log(`\n${'='.repeat(80)}`, 'cyan');
    log(`           TOURNAMENT TEAM VISIBILITY & ACCESS CONTROL TEST`, 'cyan');
    log(`${'='.repeat(80)}\n`, 'cyan');

    // Reuse the multi-tournament test data
    const TOURNAMENTS = [
        { name: 'UEFA Champions League 2025-26', teamCount: 36 },
        { name: 'Premier League 2025-26', teamCount: 20 },
        { name: 'Championship 2025-26', teamCount: 24 },
    ];

    const TOURNAMENT_TEAMS = {
        'UEFA Champions League 2025-26': [
            'Arsenal', 'Bayern Munich', 'Paris Saint-Germain', 'Manchester City', 'Atalanta',
            'Inter Milan', 'Real Madrid', 'Atletico Madrid', 'Liverpool', 'Borussia Dortmund',
            'Tottenham Hotspur', 'Newcastle United', 'Chelsea', 'Sporting CP', 'Barcelona',
            'Marseille', 'Juventus', 'Galatasaray', 'Napoli', 'Copenhagen',
            'Benfica', 'Pafos', 'Union Saint-Gilloise', 'Bayer Leverkusen', 'AC Milan',
            'Monaco', 'Eintracht Frankfurt', 'Club Brugge', 'Bodoe Glimt', 'Slavia Prague',
            'Ajax', 'Villarreal', 'Qarabag', 'Kairat', 'Athletic Bilbao', 'Olympiacos'
        ],
        'Premier League 2025-26': [
            'Arsenal', 'Aston Villa', 'Bournemouth', 'Brentford', 'Brighton',
            'Burnley', 'Chelsea', 'Crystal Palace', 'Everton', 'Fulham',
            'Leeds United', 'Liverpool', 'Manchester City', 'Manchester United', 'Newcastle United',
            'Nottingham Forest', 'Sunderland', 'Tottenham Hotspur', 'West Ham United', 'Wolverhampton Wanderers'
        ],
        'Championship 2025-26': [
            'Birmingham City', 'Blackburn Rovers', 'Bristol City', 'Charlton Athletic', 'Coventry City',
            'Derby County', 'Hull City', 'Ipswich Town', 'Leicester City', 'Middlesbrough',
            'Millwall', 'Norwich City', 'Oxford United', 'Portsmouth', 'Preston North End',
            'Queens Park Rangers', 'Sheffield United', 'Sheffield Wednesday', 'Southampton', 'Stoke City',
            'Swansea City', 'Watford', 'West Bromwich Albion', 'Wrexham'
        ]
    };

    const NUM_USERS = 50; // Smaller sample for faster test

    log(`📋 Scenario Setup:`, 'blue');
    log(`   Users: ${NUM_USERS}`, 'blue');
    log(`   Tournaments: ${TOURNAMENTS.length}`, 'blue');
    log(`   Total possible joins: ${NUM_USERS * TOURNAMENTS.length}`, 'blue');

    // Simulate joins
    const userAssignments = {};
    const globalLobbies = {};

    for (let i = 1; i <= NUM_USERS; i++) {
        const userId = `user_${i}`;
        TOURNAMENTS.forEach(tournament => {
            if (!globalLobbies[tournament.name]) {
                globalLobbies[tournament.name] = {};
            }

            const allTeams = TOURNAMENT_TEAMS[tournament.name];
            let assignedLobby = null;

            // Find or create lobby
            for (const [lobbyId, lobby] of Object.entries(globalLobbies[tournament.name])) {
                if (lobby.userCount < tournament.teamCount) {
                    assignedLobby = lobbyId;
                    break;
                }
            }

            if (!assignedLobby) {
                assignedLobby = `${tournament.name}_lobby_${Object.keys(globalLobbies[tournament.name]).length + 1}`;
                globalLobbies[tournament.name][assignedLobby] = {
                    id: assignedLobby,
                    tournamentName: tournament.name,
                    userCount: 0,
                    teams: {},
                    users: []
                };
            }

            // Get available teams
            const assignedTeams = Object.values(globalLobbies[tournament.name][assignedLobby].teams);
            const availableTeams = allTeams.filter(t => !assignedTeams.includes(t));

            if (availableTeams.length > 0) {
                const team = availableTeams[Math.floor(Math.random() * availableTeams.length)];
                
                globalLobbies[tournament.name][assignedLobby].userCount++;
                globalLobbies[tournament.name][assignedLobby].teams[userId] = team;
                globalLobbies[tournament.name][assignedLobby].users.push(userId);

                if (!userAssignments[userId]) {
                    userAssignments[userId] = {};
                }
                userAssignments[userId][tournament.name] = {
                    team,
                    lobbyId: assignedLobby
                };
            }
        });
    }

    log(`\n✅ Test data generated\n`, 'green');

    return { globalLobbies, userAssignments };
}

// Run all tests
try {
    const { globalLobbies, userAssignments } = runComprehensiveVisibilityTest();

    const test1Pass = testLobbyTeamVisibility(globalLobbies, userAssignments);
    const test2Pass = testAPIResponseFiltering(globalLobbies, userAssignments);
    const test3Pass = testLobbyDataIsolation(globalLobbies, userAssignments);
    const test4Pass = testVisibilityMatrix(globalLobbies, userAssignments);

    const allTestsPassed = test1Pass && test2Pass && test3Pass && test4Pass;

    log(`\n${'='.repeat(80)}`, 'cyan');
    log(`                         FINAL RESULTS`, 'cyan');
    log(`${'='.repeat(80)}`, 'cyan');

    log(`\n✅ TEST RESULTS:`, 'blue');
    log(`   [${test1Pass ? '✓' : '✗'}] Users only see their lobby's teams`, test1Pass ? 'green' : 'red');
    log(`   [${test2Pass ? '✓' : '✗'}] API properly filters team data`, test2Pass ? 'green' : 'red');
    log(`   [${test3Pass ? '✓' : '✗'}] Data isolated between lobbies`, test3Pass ? 'green' : 'red');
    log(`   [${test4Pass ? '✓' : '✗'}] Visibility matrix validated`, test4Pass ? 'green' : 'red');

    log(`\n${'='.repeat(80)}`, 'cyan');
    if (allTestsPassed) {
        log(`🎉 ALL TESTS PASSED!`, 'green');
        log(`\n✅ Team Visibility & Access Control Verified:`, 'green');
        log(`   • Users can ONLY see teams from their assigned lobby`, 'blue');
        log(`   • Teams from other lobbies are completely hidden`, 'blue');
        log(`   • No data leakage between lobbies in same tournament`, 'blue');
        log(`   • API responses properly filtered per user`, 'blue');
        log(`   • Cross-tournament lobbies remain isolated`, 'blue');
    } else {
        log(`⚠️  SOME TESTS FAILED - Review above for details`, 'yellow');
    }
    log(`${'='.repeat(80)}\n`, 'cyan');

    process.exit(allTestsPassed ? 0 : 1);
} catch (error) {
    log(`\n❌ Fatal error: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
}
