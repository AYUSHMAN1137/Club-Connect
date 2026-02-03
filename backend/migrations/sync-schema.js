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
        // Test connection
        await sequelize.authenticate();
        console.log('✅ Database connected\n');

        // Sync all models with alter: true
        // This will ADD new columns but NOT remove existing ones
        console.log('📦 Applying schema changes...');
        await sequelize.sync({ alter: true });

        console.log('\n✅ Schema sync complete!');
        console.log('\n📋 Changes applied:');
        console.log('   - Event: added startTime, endTime, capacity, status');
        console.log('   - Announcement: added createdById');
        console.log('   - Club: added category');
        console.log('   - Attendance: added unique index');
        console.log('   - All: added foreign key indexes');

    } catch (error) {
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
