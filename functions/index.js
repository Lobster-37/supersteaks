const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

const CHAMPIONS_LEAGUE_TEAMS = [
    { name: "Ajax", pattern: "ajax-stripe", borderColor: "#D2122E" },
    { name: "Arsenal", color: "#EF0107", borderColor: "#FFFFFF" },
    { name: "Atalanta", pattern: "stripes-vertical-blue-black", borderColor: "#1E63B0" },
    { name: "Athletic Club", pattern: "stripes-vertical-red-white", borderColor: "#EE2523" },
    { name: "Atlético Madrid", pattern: "stripes-vertical-red-white", borderColor: "#CE3524" },
    { name: "Barcelona", pattern: "stripes-vertical-blue-garnet", borderColor: "#A50044" },
    { name: "Bayer Leverkusen", color: "#000000", borderColor: "#E32221" },
    { name: "Bayern München", color: "#DC052D", borderColor: "#0066B2" },
    { name: "Benfica", color: "#E20E0E", borderColor: "#FFFFFF" },
    { name: "Bodø/Glimt", color: "#FFD700", borderColor: "#000000" },
    { name: "Borussia Dortmund", color: "#FDE100", borderColor: "#000000" },
    { name: "Chelsea", color: "#034694", borderColor: "#FFFFFF" },
    { name: "Club Brugge", pattern: "stripes-vertical-blue-black", borderColor: "#0032A0" },
    { name: "Copenhagen", color: "#FFFFFF", borderColor: "#1F4E79" },
    { name: "Eintracht Frankfurt", color: "#000000", borderColor: "#E1001C" },
    { name: "Galatasaray", pattern: "diagonal-half-yellow-red", borderColor: "#FFD700" },
    { name: "Inter Milan", pattern: "stripes-vertical-blue-black", borderColor: "#0068A8" },
    { name: "Juventus", pattern: "stripes-vertical-black-white", borderColor: "#000000" },
    { name: "Kairat Almaty", pattern: "stripes-vertical-yellow-black", borderColor: "#FFD700" },
    { name: "Liverpool", color: "#C8102E", borderColor: "#FFD700" },
    { name: "Manchester City", color: "#6CABDD", borderColor: "#FFFFFF" },
    { name: "Marseille", color: "#FFFFFF", borderColor: "#009EDB" },
    { name: "Monaco", pattern: "diagonal-half-red-white", borderColor: "#C8102E" },
    { name: "Napoli", color: "#87CEEB", borderColor: "#FFFFFF" },
    { name: "Newcastle United", pattern: "stripes-vertical-black-white", borderColor: "#000000" },
    { name: "Olympiacos", pattern: "stripes-vertical-red-white", borderColor: "#DC143C" },
    { name: "Paris Saint-Germain", color: "#004170", borderColor: "#FFD700" },
    { name: "Real Madrid", color: "#FFFFFF", borderColor: "#FFD700" },
    { name: "Slavia Praha", pattern: "stripes-vertical-red-white", borderColor: "#DC143C" },
    { name: "Sporting CP", color: "#006633", borderColor: "#FFFFFF" }
];

exports.enterDraw = functions.https.onCall(async (data, context) => {
    // Check if user is authenticated
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated to enter a draw');
    }

    const userId = context.auth.uid;
    const userEmail = context.auth.token.email;
    const displayName = context.auth.token.name || userEmail.split('@')[0];
    const contestName = data.contestName;

    if (!contestName) {
        throw new functions.https.HttpsError('invalid-argument', 'Contest name is required');
    }

    try {
        const db = admin.firestore();

        // Check if user already has assignment for this contest
        const existingSnapshot = await db.collection('teamAssignments')
            .where('userId', '==', userId)
            .where('contest', '==', contestName)
            .limit(1)
            .get();

        if (!existingSnapshot.empty) {
            const existingAssignment = existingSnapshot.docs[0].data();
            throw new functions.https.HttpsError(
                'already-exists',
                `You already have ${existingAssignment.team} assigned for this contest!`
            );
        }

        // Get all existing assignments for this contest
        const assignmentsSnapshot = await db.collection('teamAssignments')
            .where('contest', '==', contestName)
            .get();

        const assignedTeamNames = assignmentsSnapshot.docs.map(doc => doc.data().team);

        // Get available teams
        const availableTeams = CHAMPIONS_LEAGUE_TEAMS.filter(
            team => !assignedTeamNames.includes(team.name)
        );

        if (availableTeams.length === 0) {
            throw new functions.https.HttpsError(
                'resource-exhausted',
                'Sorry! All teams have been assigned. Contest is full!'
            );
        }

        // Randomly select a team (server-side randomization - secure)
        const selectedTeam = availableTeams[Math.floor(Math.random() * availableTeams.length)];

        // Create assignment document
        const assignmentData = {
            userId: userId,
            username: displayName,
            email: userEmail,
            contest: contestName,
            team: selectedTeam.name,
            teamData: selectedTeam,
            assignedAt: admin.firestore.Timestamp.now()
        };

        const docRef = await db.collection('teamAssignments').add(assignmentData);

        return {
            success: true,
            assignmentId: docRef.id,
            team: selectedTeam,
            remainingTeams: availableTeams.length - 1
        };

    } catch (error) {
        console.error('Error in enterDraw function:', error);
        if (error.code && error.code.startsWith('invalid-argument')) {
            throw error;
        }
        throw new functions.https.HttpsError(
            'internal',
            'Failed to enter draw. Please try again.'
        );
    }
});
