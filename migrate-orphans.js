const https = require('https');

const ADMIN_SECRET = 'supersteaks-admin-2026';

function migrate() {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            action: 'migrateChampionsOrphans',
            tournaments: []
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
                    resolve(result);
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

migrate()
    .then(result => {
        console.log('✅ Migration complete!');
        console.log(`   ${result.message}`);
        console.log(`   Orphaned assignments migrated: ${result.assignments}`);
        console.log(`   Orphaned lobbies migrated: ${result.lobbies}`);
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Error:', error.message);
        process.exit(1);
    });
