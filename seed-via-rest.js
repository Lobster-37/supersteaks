#!/usr/bin/env node
/**
 * Simple script to seed demo fixtures using Firebase REST API
 * This requires a valid Firebase auth token
 */

const axios = require('axios');
const admin = require('firebase-admin');

async function seedWithServiceAccount() {
    try {
        // Initialize Firebase Admin with service account
        const app = admin.initializeApp({
            projectId: 'supersteaks-240f7'
        });

        // Get an auth token using a service account user
        const auth = admin.auth();
        
        // Create a custom token for a demo user
        const uid = 'demo-seed-user-' + Date.now();
        const customToken = await auth.createCustomToken(uid);
        
        console.log('Created custom token, exchanging for ID token...');

        // Exchange custom token for ID token
        const response = await axios.post(
            'https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=AIzaSyAJF4VZM-_dJSL9p0Z2G5-Y3_JYa5TI8mw',
            {
                token: customToken,
                returnSecureToken: true
            }
        );

        const idToken = response.data.idToken;
        console.log('Got ID token, calling seedDemoFixtures...');

        // Call the Cloud Function
        const seedResponse = await axios.post(
            'https://us-central1-supersteaks-240f7.cloudfunctions.net/seedDemoFixtures',
            {},
            {
                headers: {
                    'Authorization': `Bearer ${idToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log('✅ Seed successful!');
        console.log(JSON.stringify(seedResponse.data, null, 2));
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error.response?.data || error.message);
        process.exit(1);
    }
}

seedWithServiceAccount();
