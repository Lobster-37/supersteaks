/**
 * Add Sample Tournaments to Firestore
 * Run: node add-tournaments.js
 */

const admin = require('firebase-admin');

// Initialize Firebase Admin with service account key
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const tournaments = [
  {
    name: "FIFA World Cup 2026",
    description: "The biggest tournament in football - 48 nations compete in USA, Canada & Mexico",
    teamCount: 48,
    status: "active",
    createdAt: admin.firestore.Timestamp.now(),
    createdBy: "admin",
    rules: "Represent your nation! Lobbies of 48 players each."
  },
  {
    name: "UEFA Champions League 2025-26",
    description: "Europe's elite club competition - the best of the best",
    teamCount: 32,
    status: "active",
    createdAt: admin.firestore.Timestamp.now(),
    createdBy: "admin",
    rules: "Get your European giant and chase Champions League glory"
  },
  {
    name: "UEFA Europa League 2025-26",
    description: "Europe's second-tier competition with top clubs from across the continent",
    teamCount: 32,
    status: "active",
    createdAt: admin.firestore.Timestamp.now(),
    createdBy: "admin",
    rules: "Compete in Europe's exciting second competition"
  },
  {
    name: "Premier League 2025-26",
    description: "The most-watched football league in the world - 20 English giants battle it out",
    teamCount: 20,
    status: "active",
    createdAt: admin.firestore.Timestamp.now(),
    createdBy: "admin",
    rules: "Get assigned a Premier League club and compete for the title"
  },
  {
    name: "La Liga 2025-26",
    description: "Spain's top division featuring Barcelona, Real Madrid and more",
    teamCount: 20,
    status: "active",
    createdAt: admin.firestore.Timestamp.now(),
    createdBy: "admin",
    rules: "Lead your Spanish club to La Liga glory"
  },
  {
    name: "Copa Libertadores 2026",
    description: "South America's most prestigious club tournament",
    teamCount: 32,
    status: "active",
    createdAt: admin.firestore.Timestamp.now(),
    createdBy: "admin",
    rules: "Represent South American football greatness"
  }
];

async function addTournaments() {
  try {
    console.log('🚀 Adding tournaments to Firestore...\n');
    
    for (const tournament of tournaments) {
      const docRef = await db.collection('tournaments').add(tournament);
      console.log(`✅ ${tournament.name} (${tournament.teamCount} teams)`);
      console.log(`   ID: ${docRef.id}\n`);
    }
    
    console.log('✨ All tournaments added successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error adding tournaments:', error);
    process.exit(1);
  }
}

addTournaments();
