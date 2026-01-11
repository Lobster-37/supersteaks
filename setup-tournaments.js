/**
 * Sample Tournament Setup Script
 * 
 * Usage:
 * 1. Update the firebaseConfig with your project credentials
 * 2. Replace 'YOUR_ADMIN_KEY' with actual service account key
 * 3. Run: node setup-tournaments.js
 * 
 * OR use Firebase Console to manually add tournaments
 */

const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
// Download service account key from Firebase Console > Project Settings > Service Accounts
const serviceAccount = require('./path/to/serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'supersteaks-240f7'
});

const db = admin.firestore();

// Sample tournaments
const sampleTournaments = [
  {
    name: "Premier League Cup",
    description: "Battle with the world's best clubs in this 16-team tournament",
    teamCount: 16,
    status: "active",
    createdAt: admin.firestore.Timestamp.now(),
    createdBy: "admin",
    rules: "Win your lobby to advance to playoffs"
  },
  {
    name: "UEFA Champions League",
    description: "Elite 32-team tournament format with guaranteed unique team assignment",
    teamCount: 32,
    status: "active",
    createdAt: admin.firestore.Timestamp.now(),
    createdBy: "admin",
    rules: "First come, first served lobby placement"
  },
  {
    name: "Quick Fire Cup",
    description: "Fast-paced 8-team tournament - perfect for quick games",
    teamCount: 8,
    status: "active",
    createdAt: admin.firestore.Timestamp.now(),
    createdBy: "admin",
    rules: "Winner takes all!"
  },
  {
    name: "International Friendly",
    description: "24-team tournament showcasing national squads",
    teamCount: 24,
    status: "active",
    createdAt: admin.firestore.Timestamp.now(),
    createdBy: "admin",
    rules: "No pre-match coaching allowed"
  }
];

async function setupTournaments() {
  try {
    console.log('Starting tournament setup...');
    
    // Clear existing tournaments (optional - comment out to keep)
    // const existingTournaments = await db.collection('tournaments').get();
    // for (const doc of existingTournaments.docs) {
    //   await db.collection('tournaments').doc(doc.id).delete();
    // }
    // console.log('Cleared existing tournaments');

    // Add sample tournaments
    for (const tournament of sampleTournaments) {
      const docRef = await db.collection('tournaments').add(tournament);
      console.log(`✓ Created tournament: ${tournament.name} (ID: ${docRef.id})`);
    }
    
    console.log('\n✅ Tournament setup complete!');
    console.log('\nYou can now:');
    console.log('1. Open tournaments.html in your browser');
    console.log('2. Log in with your account');
    console.log('3. Join a tournament');
    console.log('4. Get assigned a unique team in a lobby');
    
  } catch (error) {
    console.error('❌ Error setting up tournaments:', error);
  } finally {
    process.exit(0);
  }
}

setupTournaments();
