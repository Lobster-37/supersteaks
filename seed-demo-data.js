#!/usr/bin/env node

const admin = require('firebase-admin');

// Initialize Firebase Admin with specific project
const app = admin.initializeApp({
    projectId: 'supersteaks-240f7'
});
const db = admin.firestore();

const LEAGUES = {
    'premier-league': { id: '4328', name: 'Premier League', season: '2025-2026' },
    'championship': { id: '4329', name: 'Championship', season: '2025-2026' },
    'league-one': { id: '4330', name: 'League One', season: '2025-2026' },
    'league-two': { id: '4331', name: 'League Two', season: '2025-2026' },
    'champions-league': { id: '4480', name: 'Champions League', season: '2025-2026' }
};

const demoData = {
    'premier-league': {
        name: 'Premier League',
        teams: ['Liverpool', 'Arsenal', 'Manchester City', 'Chelsea', 'Manchester United', 'Tottenham', 'Brighton', 'Newcastle', 'Fulham', 'Aston Villa', 'West Ham', 'Crystal Palace', 'Brentford', 'Bournemouth', 'Everton', 'Wolverhampton', 'Nottingham Forest', 'Leicester', 'Ipswich', 'Southampton'],
        fixtures: [
            { home: 'Arsenal', away: 'Wolverhampton', date: '2026-01-25', time: '15:00:00', venue: 'Emirates Stadium' },
            { home: 'Newcastle', away: 'Fulham', date: '2026-01-25', time: '15:00:00', venue: 'St James Park' },
            { home: 'Southampton', away: 'Everton', date: '2026-01-25', time: '15:00:00', venue: 'St Mary\'s Stadium' },
            { home: 'Ipswich', away: 'Crystal Palace', date: '2026-01-25', time: '15:00:00', venue: 'Portman Road' },
            { home: 'Brighton', away: 'West Ham', date: '2026-02-01', time: '15:00:00', venue: 'Amex Stadium' },
            { home: 'Tottenham', away: 'Aston Villa', date: '2026-02-01', time: '15:00:00', venue: 'Tottenham Hotspur Stadium' },
            { home: 'Chelsea', away: 'Bournemouth', date: '2026-02-02', time: '14:00:00', venue: 'Stamford Bridge' },
            { home: 'Manchester United', away: 'Leicester', date: '2026-02-02', time: '16:30:00', venue: 'Old Trafford' },
            { home: 'Liverpool', away: 'Brentford', date: '2026-02-03', time: '20:15:00', venue: 'Anfield' },
            { home: 'Manchester City', away: 'Nottingham Forest', date: '2026-02-04', time: '19:45:00', venue: 'Etihad Stadium' },
            { home: 'Fulham', away: 'Chelsea', date: '2026-02-07', time: '15:00:00', venue: 'Craven Cottage' },
            { home: 'Everton', away: 'Brighton', date: '2026-02-07', time: '15:00:00', venue: 'Goodison Park' },
            { home: 'Wolverhampton', away: 'Southampton', date: '2026-02-07', time: '15:00:00', venue: 'Molineux Stadium' },
            { home: 'Newcastle', away: 'Manchester United', date: '2026-02-08', time: '12:30:00', venue: 'St James Park' },
            { home: 'Arsenal', away: 'Brighton', date: '2026-02-14', time: '15:00:00', venue: 'Emirates Stadium' }
        ],
        results: [
            { home: 'Manchester City', away: 'Manchester United', homeScore: 1, awayScore: 0, date: '2026-01-14', time: '20:00:00', venue: 'Etihad Stadium' },
            { home: 'Liverpool', away: 'Chelsea', homeScore: 2, awayScore: 1, date: '2026-01-17', time: '15:00:00', venue: 'Anfield' },
            { home: 'Tottenham', away: 'West Ham', homeScore: 3, awayScore: 1, date: '2026-01-18', time: '15:00:00', venue: 'Tottenham Hotspur Stadium' },
            { home: 'Newcastle', away: 'Aston Villa', homeScore: 2, awayScore: 2, date: '2026-01-19', time: '15:00:00', venue: 'St James Park' },
            { home: 'Arsenal', away: 'Ipswich', homeScore: 2, awayScore: 0, date: '2026-01-20', time: '15:00:00', venue: 'Emirates Stadium' },
            { home: 'Brighton', away: 'Fulham', homeScore: 1, awayScore: 1, date: '2026-01-21', time: '15:00:00', venue: 'Amex Stadium' },
            { home: 'Bournemouth', away: 'Southampton', homeScore: 3, awayScore: 0, date: '2026-01-22', time: '15:00:00', venue: 'Vitality Stadium' },
            { home: 'Nottingham Forest', away: 'Everton', homeScore: 1, awayScore: 1, date: '2026-01-23', time: '15:00:00', venue: 'City Ground' },
            { home: 'Leicester', away: 'Crystal Palace', homeScore: 2, awayScore: 0, date: '2026-01-24', time: '15:00:00', venue: 'King Power Stadium' },
            { home: 'Brentford', away: 'Wolverhampton', homeScore: 2, awayScore: 1, date: '2026-01-25', time: '12:30:00', venue: 'Gtech Community Stadium' }
        ]
    },
    'championship': {
        name: 'Championship',
        teams: ['Leeds United', 'West Bromwich Albion', 'Cardiff City', 'Bristol City', 'Coventry City', 'Derby County', 'Preston North End', 'Middlesbrough', 'Plymouth Argyle', 'Stoke City', 'Hull City', 'Portsmouth', 'Norwich City', 'Watford', 'Luton Town', 'Millwall', 'Reading', 'Sunderland', 'Swansea City', 'Blackburn Rovers'],
        fixtures: [
            { home: 'Leeds United', away: 'West Bromwich Albion', date: '2026-02-01', time: '15:00:00', venue: 'Elland Road' },
            { home: 'Cardiff City', away: 'Bristol City', date: '2026-02-02', time: '15:00:00', venue: 'Cardiff City Stadium' },
            { home: 'Coventry City', away: 'Derby County', date: '2026-02-03', time: '15:00:00', venue: 'Coventry City Stadium' },
            { home: 'Preston North End', away: 'Middlesbrough', date: '2026-02-04', time: '19:45:00', venue: 'Deepdale' },
            { home: 'Plymouth Argyle', away: 'Stoke City', date: '2026-02-05', time: '15:00:00', venue: 'Home Park' }
        ],
        results: [
            { home: 'Leeds United', away: 'West Bromwich Albion', homeScore: 1, awayScore: 0, date: '2026-01-20', time: '15:00:00', venue: 'Elland Road' },
            { home: 'Cardiff City', away: 'Bristol City', homeScore: 2, awayScore: 2, date: '2026-01-21', time: '15:00:00', venue: 'Cardiff City Stadium' },
            { home: 'Coventry City', away: 'Derby County', homeScore: 3, awayScore: 1, date: '2026-01-22', time: '15:00:00', venue: 'Coventry City Stadium' },
            { home: 'Preston North End', away: 'Middlesbrough', homeScore: 0, awayScore: 1, date: '2026-01-23', time: '19:45:00', venue: 'Deepdale' },
            { home: 'Plymouth Argyle', away: 'Stoke City', homeScore: 2, awayScore: 1, date: '2026-01-24', time: '15:00:00', venue: 'Home Park' }
        ]
    },
    'league-one': {
        name: 'League One',
        teams: ['Wrexham', 'Wycombe Wanderers', 'Stockport County', 'Birmingham City', 'Rotherham United', 'Leyton Orient', 'Lincoln City', 'Bolton Wanderers', 'Port Vale', 'Mansfield Town', 'Peterborough United', 'Ipswich Town', 'Cheltenham Town', 'Northampton Town', 'Shrewsbury Town', 'Crawley Town', 'Burton Albion', 'Salford City', 'MK Dons', 'Charlton Athletic'],
        fixtures: [
            { home: 'Wrexham', away: 'Wycombe Wanderers', date: '2026-02-01', time: '15:00:00', venue: 'Racecourse Ground' },
            { home: 'Stockport County', away: 'Birmingham City', date: '2026-02-02', time: '15:00:00', venue: 'Edgeley Park' },
            { home: 'Rotherham United', away: 'Leyton Orient', date: '2026-02-03', time: '19:45:00', venue: 'New York Stadium' }
        ],
        results: [
            { home: 'Wrexham', away: 'Wycombe Wanderers', homeScore: 1, awayScore: 1, date: '2026-01-22', time: '15:00:00', venue: 'Racecourse Ground' },
            { home: 'Stockport County', away: 'Birmingham City', homeScore: 2, awayScore: 0, date: '2026-01-23', time: '15:00:00', venue: 'Edgeley Park' },
            { home: 'Rotherham United', away: 'Leyton Orient', homeScore: 3, awayScore: 2, date: '2026-01-24', time: '19:45:00', venue: 'New York Stadium' }
        ]
    },
    'league-two': {
        name: 'League Two',
        teams: ['Doncaster Rovers', 'Forest Green Rovers', 'Salford City Reserve', 'Swindon Town', 'Grimsby Town', 'Bradford City', 'Harrogate Town', 'Barrow', 'Stevenage', 'Tranmere Rovers', 'Newport County', 'Colchester United', 'Southend United', 'Leyton Orient Reserve', 'Cambridge United', 'Accrington Stanley', 'Hartlepool United', 'Scunthorpe United', 'Crewe Alexandra', 'Exeter City'],
        fixtures: [
            { home: 'Doncaster Rovers', away: 'Forest Green Rovers', date: '2026-02-01', time: '15:00:00', venue: 'Keepmoat Stadium' },
            { home: 'Swindon Town', away: 'Grimsby Town', date: '2026-02-02', time: '19:45:00', venue: 'County Ground' }
        ],
        results: [
            { home: 'Doncaster Rovers', away: 'Forest Green Rovers', homeScore: 2, awayScore: 1, date: '2026-01-24', time: '15:00:00', venue: 'Keepmoat Stadium' },
            { home: 'Swindon Town', away: 'Grimsby Town', homeScore: 1, awayScore: 1, date: '2026-01-25', time: '19:45:00', venue: 'County Ground' }
        ]
    },
    'champions-league': {
        name: 'Champions League',
        teams: ['Manchester City', 'Real Madrid', 'Bayern Munich', 'PSG', 'Liverpool', 'Barcelona', 'Arsenal', 'AC Milan', 'Inter Milan', 'Juventus', 'Dortmund', 'Atletico Madrid', 'Chelsea', 'Benfica', 'Napoli', 'RB Leipzig', 'Porto', 'Ajax'],
        fixtures: [
            { home: 'Manchester City', away: 'Real Madrid', date: '2026-02-11', time: '20:00:00', venue: 'Etihad Stadium' },
            { home: 'Bayern Munich', away: 'PSG', date: '2026-02-12', time: '20:00:00', venue: 'Allianz Arena' },
            { home: 'Liverpool', away: 'Barcelona', date: '2026-02-13', time: '20:00:00', venue: 'Anfield' },
            { home: 'Arsenal', away: 'AC Milan', date: '2026-02-14', time: '20:00:00', venue: 'Emirates Stadium' },
            { home: 'Inter Milan', away: 'Juventus', date: '2026-02-15', time: '20:00:00', venue: 'San Siro' }
        ],
        results: [
            { home: 'Manchester City', away: 'Real Madrid', homeScore: 1, awayScore: 0, date: '2026-01-15', time: '20:00:00', venue: 'Etihad Stadium' },
            { home: 'Bayern Munich', away: 'PSG', homeScore: 3, awayScore: 2, date: '2026-01-16', time: '20:00:00', venue: 'Allianz Arena' },
            { home: 'Liverpool', away: 'Barcelona', homeScore: 2, awayScore: 1, date: '2026-01-17', time: '20:00:00', venue: 'Anfield' },
            { home: 'Arsenal', away: 'AC Milan', homeScore: 1, awayScore: 1, date: '2026-01-18', time: '20:00:00', venue: 'Emirates Stadium' },
            { home: 'Inter Milan', away: 'Juventus', homeScore: 2, awayScore: 0, date: '2026-01-19', time: '20:00:00', venue: 'San Siro' }
        ]
    }
};

async function seedData() {
    try {
        console.log('Starting demo data seed...\n');
        
        for (const [leagueKey, leagueConfig] of Object.entries(demoData)) {
            console.log(`Seeding ${leagueConfig.name}...`);
            
            const leagueRef = db.collection('leagues').doc(leagueKey);
            
            // Update league metadata
            await leagueRef.set({
                name: leagueConfig.name,
                leagueId: LEAGUES[leagueKey].id,
                season: '2025-2026',
                lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            
            // Seed fixtures
            const fixturesBatch = db.batch();
            leagueConfig.fixtures.forEach((fixture, idx) => {
                const fixtureRef = leagueRef.collection('fixtures').doc(`fixture_${idx}`);
                fixturesBatch.set(fixtureRef, {
                    eventId: `fixture_${leagueKey}_${idx}`,
                    homeTeam: fixture.home,
                    awayTeam: fixture.away,
                    date: fixture.date,
                    time: fixture.time,
                    venue: fixture.venue,
                    timestamp: new Date(fixture.date + 'T' + fixture.time)
                });
            });
            await fixturesBatch.commit();
            
            // Seed results
            const resultsBatch = db.batch();
            leagueConfig.results.forEach((result, idx) => {
                const resultRef = leagueRef.collection('results').doc(`result_${idx}`);
                resultsBatch.set(resultRef, {
                    eventId: `result_${leagueKey}_${idx}`,
                    homeTeam: result.home,
                    awayTeam: result.away,
                    homeScore: result.homeScore,
                    awayScore: result.awayScore,
                    date: result.date,
                    time: result.time,
                    venue: result.venue,
                    timestamp: new Date(result.date + 'T' + result.time)
                });
            });
            await resultsBatch.commit();
            
            // Seed standings (all teams with demo stats)
            const standingsBatch = db.batch();
            leagueConfig.teams.forEach((teamName, idx) => {
                const position = idx + 1;
                const played = 28 + Math.floor(Math.random() * 4);
                const won = Math.floor(Math.random() * (played - 5));
                const lost = Math.floor(Math.random() * (played - won - 2));
                const drawn = played - won - lost;
                const goalsFor = won * 2 + drawn + Math.floor(Math.random() * 5);
                const goalsAgainst = lost + drawn + Math.floor(Math.random() * 5);
                const points = won * 3 + drawn;
                
                const standingRef = leagueRef.collection('standings').doc(`team_${idx}`);
                standingsBatch.set(standingRef, {
                    teamId: `team_${leagueKey}_${idx}`,
                    teamName: teamName,
                    position: position,
                    played: played,
                    won: won,
                    drawn: drawn,
                    lost: lost,
                    goalsFor: goalsFor,
                    goalsAgainst: goalsAgainst,
                    goalDifference: goalsFor - goalsAgainst,
                    points: points
                });
            });
            await standingsBatch.commit();
            
            console.log(`✓ Seeded ${leagueConfig.name} (${leagueConfig.fixtures.length} fixtures, ${leagueConfig.results.length} results, ${leagueConfig.teams.length} standings)`);
        }
        
        console.log('\n✅ Demo data seed completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error seeding demo fixtures:', error);
        process.exit(1);
    }
}

seedData();
