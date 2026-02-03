/**
 * 🔄 MIGRATION 002: Migrate createdBy (string) → createdById (FK)
 * 
 * This script:
 * 1. Reads all announcements with createdBy username
 * 2. Looks up the user ID by username (case-insensitive)
 * 3. Updates the createdById field
 * 
 * NOTE: The createdById column must exist before running this.
 * SAFE to run multiple times - idempotent
 */

const { Announcement, User, sequelize } = require('../models');
const { Op } = require('sequelize');

async function migrateCreatedBy() {
    let totalMigrated = 0;
    let totalNotFound = 0;
    let totalSkipped = 0;

    try {
        // Get all announcements
        const announcements = await Announcement.findAll({
            attributes: ['id', 'title', 'createdBy', 'createdById']
        });

        console.log(`Found ${announcements.length} announcements to process`);

        // Build a cache of usernames → user IDs for efficiency
        const users = await User.findAll({
            attributes: ['id', 'username']
        });

        const usernameToId = {};
        for (const user of users) {
            usernameToId[user.username.toLowerCase()] = user.id;
        }
        console.log(`Loaded ${users.length} users for lookup`);

        for (const ann of announcements) {
            // Skip if already migrated
            if (ann.createdById) {
                totalSkipped++;
                continue;
            }

            // Skip if no createdBy value
            if (!ann.createdBy || ann.createdBy.trim() === '') {
                continue;
            }

            // Lookup user ID
            const username = ann.createdBy.toLowerCase();
            const userId = usernameToId[username];

            if (userId) {
                await ann.update({ createdById: userId });
                totalMigrated++;
                console.log(`  ✓ Announcement ${ann.id}: "${ann.createdBy}" → User ID ${userId}`);
            } else {
                totalNotFound++;
                console.warn(`  ⚠️ Announcement ${ann.id}: User "${ann.createdBy}" not found`);
            }
        }

        console.log(`\n📊 Migration Summary:`);
        console.log(`   Announcements migrated: ${totalMigrated}`);
        console.log(`   Already migrated (skipped): ${totalSkipped}`);
        console.log(`   Users not found: ${totalNotFound}`);

        return { totalMigrated, totalSkipped, totalNotFound };

    } catch (error) {
        // If createdById column doesn't exist yet, that's expected
        if (error.message.includes('createdById')) {
            console.log('  ℹ️ createdById column not yet added - will migrate after schema update');
            return { totalMigrated: 0, totalSkipped: 0, totalNotFound: 0, pendingSchemaUpdate: true };
        }
        console.error('Migration 002 Error:', error);
        throw error;
    }
}

module.exports = migrateCreatedBy;
