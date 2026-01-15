/**
 * Add Correct Sample Tournaments to Firestore
 * Includes: Champions League, Premier League, Championship, Ligue 1, Ligue 2
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
    name: "UEFA Champions League 2025-26",
    description: "Europe's elite club competition - the best of the best",
    teamCount: 32,
    status: "active",
    createdAt: admin.firestore.Timestamp.now(),
    createdBy: "admin",
    rules: "Get your European giant and chase Champions League glory",
    teams: [
      // Spanish Teams
      "Real Madrid", "Barcelona", "Atletico Madrid", "Sevilla",
      // English Teams
      "Manchester City", "Manchester United", "Liverpool", "Arsenal", "Chelsea", "Tottenham",
      // Italian Teams
      "Inter Milan", "AC Milan", "Juventus", "Roma", "Napoli",
      // German Teams
      "Bayern Munich", "Borussia Dortmund", "RB Leipzig", "Leverkusen",
      // French Teams
      "Paris Saint-Germain", "AS Monaco", "Marseille",
      // Portuguese Teams
      "Benfica", "Porto", "Sporting Lisbon",
      // Dutch Teams
      "Ajax", "PSV Eindhoven",
      // Other
      "Galatasaray", "Fiorentina", "Shakhtar Donetsk", "Sheriff Tiraspol"
    ]
  },
  {
    name: "Premier League 2025-26",
    description: "The most-watched football league in the world - 20 English giants battle it out",
    teamCount: 20,
    status: "active",
    createdAt: admin.firestore.Timestamp.now(),
    createdBy: "admin",
    rules: "Get assigned a Premier League club and compete for the title",
    teams: [
      "Manchester City", "Manchester United", "Liverpool", "Arsenal", "Chelsea",
      "Tottenham", "Newcastle United", "Brighton", "Aston Villa", "Wolves",
      "Everton", "Leicester City", "Brentford", "West Ham", "Southampton",
      "Crystal Palace", "Fulham", "Ipswich Town", "Nottingham Forest", "Luton Town"
    ]
  },
  {
    name: "Championship 2025-26",
    description: "England's second division - 24 teams fighting for promotion to the Premier League",
    teamCount: 24,
    status: "active",
    createdAt: admin.firestore.Timestamp.now(),
    createdBy: "admin",
    rules: "Lead your club to promotion from the Championship",
    teams: [
      "Leeds United", "Southampton", "Leicester City", "Ipswich Town", "Norwich City",
      "Coventry City", "West Bromwich Albion", "Sunderland", "Burnley", "Watford",
      "Middlesbrough", "Bristol City", "Derby County", "Plymouth Argyle", "Preston North End",
      "Millwall", "Hull City", "Luton Town", "Blackburn Rovers", "Stoke City",
      "Swansea City", "Sheffield United", "Cardiff City", "Blackpool"
    ]
  },
  {
    name: "Ligue 1 2025-26",
    description: "France's top division - 20 elite clubs compete in Ligue 1",
    teamCount: 20,
    status: "active",
    createdAt: admin.firestore.Timestamp.now(),
    createdBy: "admin",
    rules: "Take control of a French club and dominate Ligue 1",
    teams: [
      "Paris Saint-Germain", "Olympique Marseille", "AS Monaco", "Olympique Lyonnais",
      "LOSC Lille", "AS Saint-Étienne", "Stade Rennais", "FC Nantes", "AJ Auxerre",
      "Montpellier HSC", "OGC Nice", "Angers SCO", "Lens", "Strasbourg",
      "Toulouse FC", "Reims", "Brest", "Le Havre", "Metz", "Clermont Foot"
    ]
  },
  {
    name: "Ligue 2 2025-26",
    description: "France's second division - 20 clubs competing for promotion",
    teamCount: 20,
    status: "active",
    createdAt: admin.firestore.Timestamp.now(),
    createdBy: "admin",
    rules: "Guide your club to promotion from Ligue 2",
    teams: [
      "FC Nantes", "AS Saint-Étienne", "Angers SCO", "Pau FC", "Dijon FCO",
      "Amiens SC", "ESTAC Troyes", "Red Star FC", "Dunkerque", "Grenoble Foot",
      "Caen", "Paris FC", "Gazélec Ajaccio", "Laval", "Rodez AF",
      "Châteauroux", "Quevilly-Rouen", "Niort", "Lorient", "Sochaux"
    ]
  }
];

async function addTournaments() {
  try {
    console.log('🚀 Adding new tournaments to Firestore...\n');
    
    for (const tournament of tournaments) {
      const docRef = await db.collection('tournaments').add(tournament);
      console.log(`✅ ${tournament.name}`);
      console.log(`   Teams: ${tournament.teamCount}`);
      console.log(`   ID: ${docRef.id}\n`);
    }
    
    console.log('✨ All tournaments added successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

addTournaments();

