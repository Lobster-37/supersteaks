#!/usr/bin/env node

const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin SDK
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://supersteaks-240f7.firebaseio.com'
});

const db = admin.firestore();
const auth = admin.auth();

async function migrateUsernames() {
    console.log('🚀 Starting username migration...\n');

    let stats = {
        total: 0,
        updated: 0,
        skipped: 0,
        errors: []
    };

    try {
        // Get all team assignments
        const assignmentsSnap = await db.collection('teamAssignments').get();
        stats.total = assignmentsSnap.size;

        console.log(`📊 Found ${stats.total} total team assignments\n`);

        if (stats.total === 0) {
            console.log('✅ No assignments to update!');
            return;
        }

        // Process each assignment
        for (const doc of assignmentsSnap.docs) {
            const assignment = doc.data();
            const assignmentId = doc.id;

            // Skip if already has username
            if (assignment.username && assignment.username !== 'undefined') {
                console.log(`⏭️  Assignment ${assignmentId}: Already has username "${assignment.username}"`);
                stats.skipped++;
                continue;
            }

            try {
                const userId = assignment.userId;
                
                // Get user from Firebase Auth
                const user = await auth.getUser(userId);
                const username = user.displayName || user.email?.split('@')[0] || 'User';

                // Update assignment with username
                await db.collection('teamAssignments').doc(assignmentId).update({
                    username: username
                });

                console.log(`✅ Assignment ${assignmentId}: Updated with username "${username}"`);
                stats.updated++;

            } catch (error) {
                const errorMsg = `❌ Assignment ${assignmentId}: ${error.message}`;
                console.log(errorMsg);
                stats.errors.push({
                    assignmentId,
                    userId: assignment.userId,
                    error: error.message
                });
                stats.skipped++;
            }
        }

        // Print summary
        console.log('\n' + '='.repeat(60));
        console.log('📋 Migration Summary');
        console.log('='.repeat(60));
        console.log(`Total assignments processed:  ${stats.total}`);
        console.log(`✅ Successfully updated:       ${stats.updated}`);
        console.log(`⏭️  Skipped (already done):    ${stats.skipped - stats.errors.length}`);
        console.log(`❌ Errors:                     ${stats.errors.length}`);
        console.log('='.repeat(60));

        if (stats.errors.length > 0) {
            console.log('\n⚠️  Errors encountered:');
            stats.errors.forEach(err => {
                console.log(`   - Assignment: ${err.assignmentId}, User: ${err.userId}, Error: ${err.error}`);
            });
        }

        if (stats.updated > 0) {
            console.log(`\n🎉 Successfully updated ${stats.updated} assignments with usernames!`);
        } else {
            console.log('\n✅ All assignments already had usernames or no updates needed.');
        }

    } catch (error) {
        console.error('\n💥 Fatal error during migration:', error);
        process.exit(1);
    }
}

// Run migration
migrateUsernames()
    .then(() => {
        console.log('\n✨ Migration complete!');
        process.exit(0);
    })
    .catch(error => {
        console.error('Error:', error);
        process.exit(1);
    });
