const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json.json.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const functions = admin.functions();

async function triggerUpdate() {
    try {
        console.log('Triggering Championship data update...');
        const result = await functions.taskQueue('locations/us-central1/functions/updateSportsDataChampionship').enqueue({});
        console.log('Update triggered successfully:', result);
    } catch (error) {
        console.error('Error:', error.message);
        // Try HTTP trigger instead
        const https = require('https');
        const options = {
            hostname: 'us-central1-supersteaks-240f7.cloudfunctions.net',
            path: '/triggerSportsUpdateHttp?league=championship',
            method: 'GET'
        };
        
        const req = https.request(options, (res) => {
            console.log(`Status: ${res.statusCode}`);
            res.on('data', (d) => {
                process.stdout.write(d);
            });
            res.on('end', () => {
                process.exit(0);
            });
        });
        
        req.on('error', (e) => {
            console.error(e);
            process.exit(1);
        });
        
        req.end();
    }
}

triggerUpdate();
