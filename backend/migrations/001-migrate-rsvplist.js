/**
 * 🔄 MIGRATION 001: Migrate rsvpList JSON → EventRSVPs Table
 * 
 * This script:
 * 1. Reads all events with rsvpList JSON data
 * 2. Parses the JSON array of user IDs
 * 3. Inserts each RSVP into the EventRSVPs table
 * 4. Skips duplicates (uses findOrCreate)
 * 
 * SAFE to run multiple times - idempotent
 */

const { Event, EventRSVP, sequelize } = require('../models');

async function migrateRsvpList() {
    let totalMigrated = 0;
    let totalSkipped = 0;
    let eventsProcessed = 0;

    try {
        // Get all events
        const events = await Event.findAll({
            attributes: ['id', 'title', 'rsvpList']
        });

        console.log(`Found ${events.length} events to process`);

        for (const event of events) {
            let userIds = [];

            // Parse rsvpList JSON
            try {
                if (event.rsvpList && event.rsvpList !== '[]') {
                    userIds = JSON.parse(event.rsvpList);
                    if (!Array.isArray(userIds)) {
                        userIds = [];
                    }
                }
            } catch (parseError) {
                console.warn(`  ⚠️ Event ${event.id}: Invalid JSON in rsvpList, skipping`);
                continue;
            }

            if (userIds.length === 0) {
                continue;
            }

            // Insert each RSVP
            for (const userId of userIds) {
                try {
                    const [rsvp, created] = await EventRSVP.findOrCreate({
                        where: { eventId: event.id, userId: userId },
                        defaults: {
                            status: 'going',
                            timestamp: new Date()
                        }
                    });

                    if (created) {
                        totalMigrated++;
                    } else {
                        totalSkipped++; // Already exists
                    }
                } catch (insertError) {
                    console.warn(`  ⚠️ Event ${event.id}, User ${userId}: ${insertError.message}`);
                }
            }

            eventsProcessed++;
            console.log(`  ✓ Event ${event.id} "${event.title}": ${userIds.length} RSVPs`);
        }

        console.log(`\n📊 Migration Summary:`);
        console.log(`   Events processed: ${eventsProcessed}`);
        console.log(`   RSVPs migrated: ${totalMigrated}`);
        console.log(`   RSVPs skipped (already exist): ${totalSkipped}`);

        return { eventsProcessed, totalMigrated, totalSkipped };

    } catch (error) {
        console.error('Migration 001 Error:', error);
        throw error;
    }
}

module.exports = migrateRsvpList;
