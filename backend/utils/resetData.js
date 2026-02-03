/**
 * 🧹 DATA RESET SCRIPT
 * Keeps: User and Club credentials (login info)
 * Deletes: Events, Memberships, Announcements, Attendance, RSVPs, PointHistory, Notifications
 */

const { User, Club, Event, Membership, Announcement, Attendance, EventRSVP, PointHistory, Notification, sequelize } = require('../models');
const fs = require('fs');
const path = require('path');

async function resetAllData() {
    console.log('\n🧹 ========== DATA RESET STARTED ==========\n');

    try {
        // 1. Delete all Events
        const eventsDeleted = await Event.destroy({ where: {} });
        console.log(`✅ Events deleted: ${eventsDeleted}`);

        // 2. Delete all Memberships (club memberships, points, ranks)
        const membershipsDeleted = await Membership.destroy({ where: {} });
        console.log(`✅ Memberships deleted: ${membershipsDeleted}`);

        // 3. Delete all Announcements
        const announcementsDeleted = await Announcement.destroy({ where: {} });
        console.log(`✅ Announcements deleted: ${announcementsDeleted}`);

        // 4. Delete all Attendance records
        const attendanceDeleted = await Attendance.destroy({ where: {} });
        console.log(`✅ Attendance records deleted: ${attendanceDeleted}`);

        // 5. Delete all Event RSVPs
        const rsvpsDeleted = await EventRSVP.destroy({ where: {} });
        console.log(`✅ Event RSVPs deleted: ${rsvpsDeleted}`);

        // 6. Delete all Point History
        const pointHistoryDeleted = await PointHistory.destroy({ where: {} });
        console.log(`✅ Point History deleted: ${pointHistoryDeleted}`);

        // 7. Delete all Notifications
        const notificationsDeleted = await Notification.destroy({ where: {} });
        console.log(`✅ Notifications deleted: ${notificationsDeleted}`);

        // 8. Clear JSON files (legacy data)
        const jsonFiles = [
            'events.json',
            'announcements.json',
            'attendance.json',
            'galleries.json',
            'member-certificates.json',
            'certificates.json',
            'messages.json',
            'notifications.json'
        ];

        const backendDir = path.join(__dirname, '..');

        for (const file of jsonFiles) {
            const filePath = path.join(backendDir, file);
            if (fs.existsSync(filePath)) {
                fs.writeFileSync(filePath, '[]', 'utf8');
                console.log(`✅ Cleared: ${file}`);
            }
        }

        console.log('\n📊 ========== REMAINING DATA (PRESERVED) ==========\n');

        // Show remaining Users
        const users = await User.findAll();
        console.log(`👤 Users (${users.length}):`);
        for (const user of users) {
            console.log(`   - ${user.username} (${user.role}) - ${user.email}`);
        }

        // Show remaining Clubs
        const clubs = await Club.findAll({
            include: [{ model: User, as: 'Owner', attributes: ['username'] }]
        });
        console.log(`\n🏢 Clubs (${clubs.length}):`);
        for (const club of clubs) {
            console.log(`   - ${club.name} (Owner: ${club.Owner ? club.Owner.username : 'N/A'})`);
        }

        console.log('\n✅ ========== DATA RESET COMPLETE ==========\n');
        console.log('📝 Summary:');
        console.log('   - User credentials: PRESERVED ✅');
        console.log('   - Club info: PRESERVED ✅');
        console.log('   - Events: DELETED 🗑️');
        console.log('   - Memberships: DELETED 🗑️');
        console.log('   - Announcements: DELETED 🗑️');
        console.log('   - Attendance: DELETED 🗑️');
        console.log('   - RSVPs: DELETED 🗑️');
        console.log('   - Point History: DELETED 🗑️');
        console.log('   - Notifications: DELETED 🗑️');

        return true;
    } catch (error) {
        console.error('❌ Error during reset:', error);
        return false;
    }
}

// Run the reset
resetAllData()
    .then(success => {
        if (success) {
            console.log('\n🎉 Done! You can close this window.');
        } else {
            console.log('\n⚠️ Reset completed with errors.');
        }
        process.exit(0);
    })
    .catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
