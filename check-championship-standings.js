const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json.json.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkStandings() {
    const snapshot = await db.collection('leagues').doc('championship').collection('standings').orderBy('position').get();
    
    console.log('Championship Standings:');
    snapshot.forEach(doc => {
        const d = doc.data();
        console.log(`${d.position}. ${d.teamName} - Played: ${d.played}, Points: ${d.points}`);
    });
    
    process.exit(0);
}

checkStandings();
