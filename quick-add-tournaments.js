/**
 * Quick Tournament Adder
 * Run: node quick-add-tournaments.js
 * 
 * This script adds tournaments to Firestore via the admin endpoint
 */

const https = require('https');

const tournaments = [
    {
        name: "UEFA Champions League 2025-26",
        description: "Europe's elite club competition - the best of the best",
        teamCount: 32,
        teams: [
            "Real Madrid", "Barcelona", "Atletico Madrid", "Sevilla",
            "Manchester City", "Manchester United", "Liverpool", "Arsenal", "Chelsea", "Tottenham",
            "Inter Milan", "AC Milan", "Juventus", "Roma", "Napoli",
            "Bayern Munich", "Borussia Dortmund", "RB Leipzig", "Leverkusen",
            "Paris Saint-Germain", "AS Monaco", "Marseille",
            "Benfica", "Porto", "Sporting Lisbon",
            "Ajax", "PSV Eindhoven",
            "Galatasaray", "Fiorentina", "Shakhtar Donetsk", "Sheriff Tiraspol"
        ]
    },
    {
        name: "Championship 2025-26",
        description: "England's second division - 24 teams fighting for promotion",
        teamCount: 24,
        teams: [
            "Birmingham City", "Blackburn Rovers", "Bristol City", "Charlton Athletic", "Coventry City",
            "Derby County", "Hull City", "Ipswich Town", "Leicester City", "Middlesbrough",
            "Millwall", "Norwich City", "Oxford United", "Portsmouth", "Preston North End",
            "Queens Park Rangers", "Sheffield United", "Sheffield Wednesday", "Southampton", "Stoke City",
            "Swansea City", "Watford", "West Bromwich Albion", "Wrexham"
        ]
    },
    {
        name: "Premier League 2025-26",
        description: "The most-watched football league in the world - 20 English giants",
        teamCount: 20,
        teams: [
            "Arsenal", "Aston Villa", "Bournemouth", "Brentford", "Brighton",
            "Burnley", "Chelsea", "Crystal Palace", "Everton", "Fulham",
            "Leeds United", "Liverpool", "Manchester City", "Manchester United", "Newcastle United",
            "Nottingham Forest", "Sunderland", "Tottenham Hotspur", "West Ham United", "Wolverhampton Wanderers"
        ]
    },
    {
        name: "League One 2025-26",
        description: "England's third tier - 24 ambitious clubs",
        teamCount: 24,
        teams: [
            "AFC Wimbledon", "Barnsley", "Blackpool", "Bolton Wanderers", "Bradford City",
            "Burton Albion", "Cardiff City", "Doncaster Rovers", "Exeter City", "Huddersfield Town",
            "Leyton Orient", "Lincoln City", "Luton Town", "Mansfield Town", "Northampton Town",
            "Peterborough United", "Plymouth Argyle", "Port Vale", "Reading", "Rotherham United",
            "Stevenage", "Stockport County", "Wigan Athletic", "Wycombe Wanderers"
        ]
    },
    {
        name: "League Two 2025-26",
        description: "England's fourth tier - 24 clubs battling for promotion",
        teamCount: 24,
        teams: [
            "Accrington Stanley", "Barnet", "Barrow", "Bristol Rovers", "Bromley",
            "Cambridge United", "Cheltenham Town", "Chesterfield", "Colchester United", "Crawley Town",
            "Crewe Alexandra", "Fleetwood Town", "Gillingham", "Grimsby Town", "Harrogate Town",
            "Milton Keynes Dons", "Newport County", "Notts County", "Oldham Athletic", "Salford City",
            "Shrewsbury Town", "Swindon Town", "Tranmere Rovers", "Walsall"
        ]
    }
];

const ADMIN_SECRET = 'supersteaks-admin-2026';
const FUNCTION_URL = 'https://us-central1-supersteaks-240f7.cloudfunctions.net/addTournamentsAdmin';
// Reverse order so newest created docs appear in desired sequence
const orderedTournaments = [...tournaments].reverse();

function callFunction(data, action = 'refresh') {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            action: action,
            tournaments: data
        });

        const options = {
            hostname: 'us-central1-supersteaks-240f7.cloudfunctions.net',
            path: '/addTournamentsAdmin',
            method: 'POST',
            headers: {
                'x-admin-secret': ADMIN_SECRET,
                'Content-Type': 'application/json',
                'Content-Length': payload.length
            }
        };

        const req = https.request(options, (res) => {
            let responseData = '';
            res.on('data', chunk => responseData += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(responseData);
                    if (res.statusCode === 200) {
                        resolve(result);
                    } else {
                        reject(new Error(result.error || 'Unknown error'));
                    }
                } catch (e) {
                    reject(new Error('Invalid response: ' + responseData));
                }
            });
        });

        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

async function main() {
    console.log('🗑️ Cleaning up old tournaments...\n');
    
    console.log('🚀 Adding tournaments...\n');
    
        orderedTournaments.forEach(t => {
        console.log(`  • ${t.name} (${t.teamCount} teams)`);
    });

    console.log('\n⏳ Sending to Cloud Function...\n');

    try {
        // First, delete all existing tournaments
        const deleteResult = await callFunction([], 'deleteAll');
        console.log('✅ Cleanup complete: ' + deleteResult.message);
        
        // Then add the new tournaments
        console.log('\n🚀 Adding new tournaments...\n');
        const result = await callFunction(orderedTournaments);
        console.log('✅ Success!');
        console.log(`   ${result.message}`);
        console.log(`   Added ${result.count} tournaments\n`);
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

main();
