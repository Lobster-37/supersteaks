// Manual trigger for sports data update
// Run this after deploying functions to populate initial data

const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function triggerUpdate() {
    console.log('Manually triggering sports data update...');
    console.log('Note: This will take a few minutes as it fetches data for 5 leagues.');
    console.log('');
    
    // You can call your Cloud Function directly here or via HTTP
    // For now, this is just a placeholder - you'll trigger it via Firebase Console
    
    console.log('To trigger the update:');
    console.log('1. Deploy functions: firebase deploy --only functions');
    console.log('2. Go to Firebase Console > Functions');
    console.log('3. Find "updateSportsData" function');
    console.log('4. Click "..." menu > "View logs"');
    console.log('5. The function will run every 10 minutes automatically');
    console.log('');
    console.log('Or call the HTTP trigger function from your browser:');
    console.log('(You need to be logged in as admin)');
    console.log('');
    console.log('Alternative: Test API endpoint directly:');
    const testUrl = 'https://www.thesportsdb.com/api/v1/json/123/eventsnextleague.php?id=4328';
    console.log(`Test URL: ${testUrl}`);
}

triggerUpdate().then(() => {
    console.log('Done!');
    process.exit(0);
}).catch(error => {
    console.error('Error:', error);
    process.exit(1);
});
