const admin = require('firebase-admin');
const axios = require('axios');

const serviceAccount = require('./serviceAccountKey.json.json.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const API_KEY = '3';
const BASE_URL = 'https://www.thesportsdb.com/api/v1/json';

const leagueKey = 'championship';
const leagueMeta = {
  id: 4329,
  name: 'Championship',
  season: '2025-2026'
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const slugify = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

function buildStandingsFromResults(resultsSnapshot) {
  const standingsMap = {};

  resultsSnapshot.forEach(doc => {
    const result = doc.data();
    const { homeTeam, awayTeam, homeScore, awayScore } = result;
    if (homeScore === null || awayScore === null || homeScore === undefined || awayScore === undefined) return;

    const homeGoals = parseInt(homeScore, 10) || 0;
    const awayGoals = parseInt(awayScore, 10) || 0;

    if (!standingsMap[homeTeam]) {
      standingsMap[homeTeam] = { team: homeTeam, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0 };
    }
    if (!standingsMap[awayTeam]) {
      standingsMap[awayTeam] = { team: awayTeam, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0 };
    }

    standingsMap[homeTeam].played++;
    standingsMap[awayTeam].played++;
    standingsMap[homeTeam].goalsFor += homeGoals;
    standingsMap[homeTeam].goalsAgainst += awayGoals;
    standingsMap[awayTeam].goalsFor += awayGoals;
    standingsMap[awayTeam].goalsAgainst += homeGoals;

    if (homeGoals > awayGoals) {
      standingsMap[homeTeam].won++;
      standingsMap[homeTeam].points += 3;
      standingsMap[awayTeam].lost++;
    } else if (homeGoals < awayGoals) {
      standingsMap[awayTeam].won++;
      standingsMap[awayTeam].points += 3;
      standingsMap[homeTeam].lost++;
    } else {
      standingsMap[homeTeam].drawn++;
      standingsMap[awayTeam].drawn++;
      standingsMap[homeTeam].points += 1;
      standingsMap[awayTeam].points += 1;
    }

    standingsMap[homeTeam].goalDifference = standingsMap[homeTeam].goalsFor - standingsMap[homeTeam].goalsAgainst;
    standingsMap[awayTeam].goalDifference = standingsMap[awayTeam].goalsFor - standingsMap[awayTeam].goalsAgainst;
  });

  const calculatedArray = Object.values(standingsMap);
  calculatedArray.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
    return a.team.localeCompare(b.team);
  });

  return calculatedArray.map((team, index) => ({
    position: index + 1,
    teamName: team.team,
    played: team.played,
    won: team.won,
    drawn: team.drawn,
    lost: team.lost,
    goalsFor: team.goalsFor,
    goalsAgainst: team.goalsAgainst,
    goalDifference: team.goalDifference,
    points: team.points
  }));
}

async function fetchRound(round) {
  const url = `${BASE_URL}/${API_KEY}/eventsround.php?id=${leagueMeta.id}&r=${round}&s=${leagueMeta.season}`;
  let attempts = 0;
  while (attempts < 4) {
    try {
      const { data } = await axios.get(url, { timeout: 8000 });
      return data && Array.isArray(data.events) ? data.events : [];
    } catch (err) {
      attempts++;
      const status = err.response && err.response.status;
      if (status === 429 && attempts < 4) {
        await sleep(60000);
        continue;
      }
      if (attempts < 4) {
        await sleep(3000);
        continue;
      }
      throw err;
    }
  }
  return [];
}

async function saveEvents(events) {
  if (!events.length) return { resultsSaved: 0, fixturesSaved: 0 };
  const leagueRef = db.collection('leagues').doc(leagueKey);
  const resultsBatch = db.batch();
  const fixturesBatch = db.batch();
  let resultsSaved = 0;
  let fixturesSaved = 0;

  events.forEach(event => {
    const homeTeam = event.strHomeTeam;
    const awayTeam = event.strAwayTeam;
    if (!homeTeam || !awayTeam) return;

    const date = event.dateEvent || event.dateEventLocal || null;
    const time = event.strTime || '00:00:00';
    const timestamp = event.strTimestamp ? new Date(event.strTimestamp) : (date ? new Date(`${date}T${time}`) : null);
    const eventId = event.idEvent ? `${event.idEvent}` : `api_${date || 'unknown'}_${slugify(homeTeam)}_${slugify(awayTeam)}`;

    const homeScore = event.intHomeScore !== null && event.intHomeScore !== undefined ? parseInt(event.intHomeScore, 10) : null;
    const awayScore = event.intAwayScore !== null && event.intAwayScore !== undefined ? parseInt(event.intAwayScore, 10) : null;

    const baseData = {
      eventId,
      homeTeam,
      awayTeam,
      date,
      time,
      venue: event.strVenue || null,
      timestamp: timestamp || null,
      source: 'sportsdb',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (homeScore === null || awayScore === null) {
      fixturesBatch.set(leagueRef.collection('fixtures').doc(eventId), baseData, { merge: true });
      fixturesSaved++;
    } else {
      resultsBatch.set(leagueRef.collection('results').doc(eventId), {
        ...baseData,
        homeScore,
        awayScore
      }, { merge: true });
      resultsSaved++;
    }
  });

  await Promise.all([resultsBatch.commit(), fixturesBatch.commit()]);
  return { resultsSaved, fixturesSaved };
}

async function main() {
  const leagueRef = db.collection('leagues').doc(leagueKey);

  await leagueRef.set({
    name: leagueMeta.name,
    leagueId: leagueMeta.id,
    season: leagueMeta.season,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  let totalImported = 0;
  let totalFixtures = 0;

  const fixturesSnap = await leagueRef.collection('fixtures').get();
  if (!fixturesSnap.empty) {
    const deleteBatch = db.batch();
    fixturesSnap.docs.forEach(doc => deleteBatch.delete(doc.ref));
    await deleteBatch.commit();
  }

  for (let round = 1; round <= 46; round++) {
    const events = await fetchRound(round);
    const saved = await saveEvents(events);
    totalImported += saved.resultsSaved;
    totalFixtures += saved.fixturesSaved;
    console.log(`Round ${round}: ${saved.resultsSaved} results, ${saved.fixturesSaved} fixtures saved`);
    await sleep(2100);
  }

  const resultsSnapshot = await leagueRef.collection('results').get();
  const standings = buildStandingsFromResults(resultsSnapshot);

  const standingsSnap = await leagueRef.collection('standings').get();
  const deleteBatch = db.batch();
  standingsSnap.docs.forEach(doc => deleteBatch.delete(doc.ref));
  await deleteBatch.commit();

  const batch = db.batch();
  standings.forEach(team => {
    const ref = leagueRef.collection('standings').doc(`${team.position}`);
    batch.set(ref, team);
  });
  await batch.commit();

  console.log(`Imported ${totalImported} results, ${totalFixtures} fixtures and updated standings for ${leagueMeta.name}.`);
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err.response ? err.response.data : err);
  process.exit(1);
});
