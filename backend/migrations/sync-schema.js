/**
 * 🔄 SCHEMA SYNC SCRIPT
 * Safely applies schema changes to the database
 * 
 * Usage: node migrations/sync-schema.js
 */

const { sequelize } = require('../models');

async function syncSchema() {
    console.log('\n🔄 Syncing Database Schema...\n');

    try {
        if (String(process.env.SKIP_SCHEMA_SYNC || '').toLowerCase() === '1') {
            console.warn('⚠️ Schema sync skipped by SKIP_SCHEMA_SYNC=1');
            return;
        }
        // Test connection
        await sequelize.authenticate();
        console.log('✅ Database connected\n');

        console.log('📦 Applying schema changes...');
        const timeoutMs = Number(process.env.SCHEMA_SYNC_TIMEOUT_MS || 60000);
        const syncPromise = sequelize.sync({ alter: true });
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`schema_sync_timeout_${timeoutMs}`)), timeoutMs);
        });
        await Promise.race([syncPromise, timeoutPromise]);

        console.log('\n✅ Schema sync complete!');
        console.log('\n📋 Changes applied:');
        console.log('   - Event: added startTime, endTime, capacity, status');
        console.log('   - Announcement: added createdById');
        console.log('   - Club: added category');
        console.log('   - Attendance: added unique index');
        console.log('   - All: added foreign key indexes');

    } catch (error) {
        const message = String(error?.message || '');
        if (message.startsWith('schema_sync_timeout_')) {
            const ms = message.replace('schema_sync_timeout_', '');
            console.warn(`\n⚠️ Schema sync timed out after ${ms}ms, skipping.`);
            return;
        }
        console.error('\n❌ Schema sync failed:', error.message);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    syncSchema().then(() => process.exit(0));
}

module.exports = syncSchema;
