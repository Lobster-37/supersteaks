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
            "Leeds United", "Southampton", "Leicester City", "Ipswich Town", "Norwich City",
            "Coventry City", "West Bromwich Albion", "Sunderland", "Burnley", "Watford",
            "Middlesbrough", "Bristol City", "Derby County", "Plymouth Argyle", "Preston North End",
            "Millwall", "Hull City", "Luton Town", "Blackburn Rovers", "Stoke City",
            "Swansea City", "Sheffield United", "Cardiff City", "Blackpool"
        ]
    },
    {
        name: "Premier League 2025-26",
        description: "The most-watched football league in the world - 20 English giants",
        teamCount: 20,
        teams: [
            "Manchester City", "Manchester United", "Liverpool", "Arsenal", "Chelsea",
            "Tottenham", "Newcastle United", "Brighton", "Aston Villa", "Wolves",
            "Everton", "Leicester City", "Brentford", "West Ham", "Southampton",
            "Crystal Palace", "Fulham", "Ipswich Town", "Nottingham Forest", "Luton Town"
        ]
    },
    {
        name: "League One 2025-26",
        description: "England's third tier - 24 ambitious clubs",
        teamCount: 24,
        teams: [
            "Wycombe Wanderers", "Stockport County", "Reading", "Wrexham", "Rotherham United",
            "Bolton Wanderers", "MK Dons", "Charlton Athletic", "Huddersfield Town", "Peterborough United",
            "Bristol Rovers", "Oxford United", "Lincoln City", "Northampton Town", "Stevenage",
            "Crawley Town", "Shrewsbury Town", "Leyton Orient", "Colchester United", "Wigan Athletic",
            "Cambridge United", "Exeter City", "Cheltenham Town", "Blackpool"
        ]
    },
    {
        name: "League Two 2025-26",
        description: "England's fourth tier - 24 clubs battling for promotion",
        teamCount: 24,
        teams: [
            "Newport County", "Forest Green Rovers", "Salford City", "Swindon Town", "Barrow",
            "Accrington Stanley", "Tranmere Rovers", "Grimsby Town", "Doncaster Rovers", "Harrogate Town",
            "Mansfield Town", "Carlisle United", "Port Vale", "Scunthorpe United", "Crewe Alexandra",
            "Sutton United", "Torquay United", "Oldham Athletic", "Stockton Town", "Notts County",
            "Morecambe", "Sunderland U23", "Bradford City", "Hartley Wintney"
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
