/**
 * 🔄 DATABASE MIGRATION RUNNER
 * Runs all migrations in order for CLUB CONNECT database optimization
 * 
 * Usage: node migrations/run-migrations.js
 */

const { sequelize } = require('../models');
const migrateRsvpList = require('./001-migrate-rsvplist');
const migrateCreatedBy = require('./002-migrate-createdby');

async function runMigrations() {
    console.log('\n🚀 Starting Database Migrations...\n');
    console.log('='.repeat(50));

    try {
        // Test database connection
        await sequelize.authenticate();
        console.log('✅ Database connection established\n');

        // Migration 1: rsvpList JSON → EventRSVPs
        console.log('📦 Migration 1: rsvpList → EventRSVPs');
        console.log('-'.repeat(50));
        await migrateRsvpList();
        console.log('✅ Migration 1 complete!\n');

        // Migration 2: createdBy string → createdById FK
        console.log('📦 Migration 2: createdBy → createdById');
        console.log('-'.repeat(50));
        await migrateCreatedBy();
        console.log('✅ Migration 2 complete!\n');

        console.log('='.repeat(50));
        console.log('🎉 All migrations completed successfully!\n');

    } catch (error) {
        console.error('\n❌ Migration failed:', error.message);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    runMigrations().then(() => process.exit(0));
}

module.exports = runMigrations;
