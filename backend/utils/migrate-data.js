/**
 * 🔄 DATA MIGRATION SCRIPT
 * Migrates data from JSON files to SQLite Database
 * Run this ONCE to transfer all your data!
 */

const fs = require('fs');
const path = require('path');
// const bcrypt = require('bcryptjs');

// Import database models
const { sequelize, User, Club, Event, Membership, Announcement, Attendance } = require('../models');

// JSON file paths
const MEMBERS_FILE = path.join(__dirname, '../members.json');
const EVENTS_FILE = path.join(__dirname, '../events.json');
const ANNOUNCEMENTS_FILE = path.join(__dirname, '../announcements.json');
const ATTENDANCE_FILE = path.join(__dirname, '../attendance.json');
const CLUBS_DIR = path.join(__dirname, '../clubs');

// Helper to read JSON files safely
function readJSON(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error(`❌ Error reading ${filePath}:`, error.message);
        return [];
    }
}

// Helper to read all club files
function readAllClubs() {
    const clubs = [];
    try {
        if (fs.existsSync(CLUBS_DIR)) {
            const files = fs.readdirSync(CLUBS_DIR);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const filePath = path.join(CLUBS_DIR, file);
                    const club = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    clubs.push(club);
                }
            }
        }
    } catch (error) {
        console.error('❌ Error reading clubs folder:', error.message);
    }
    return clubs.sort((a, b) => a.id - b.id);
}

// Main migration function
async function migrateData() {
    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║     🔄 CLUB CONNECT - DATA MIGRATION           ║');
    console.log('║     JSON ➡️  SQLite Database                    ║');
    console.log('╚════════════════════════════════════════════════╝\n');

    try {
        // Step 1: Sync database
        console.log('📦 Step 1: Creating database tables...');
        await sequelize.query('PRAGMA foreign_keys = OFF;');
        await sequelize.sync({ force: true });
        await sequelize.query('PRAGMA foreign_keys = ON;');
        console.log('✅ Tables created successfully!\n');

        // Step 2: Read JSON data
        console.log('📂 Step 2: Reading JSON files...');
        const members = readJSON(MEMBERS_FILE);
        const events = readJSON(EVENTS_FILE);
        const announcements = readJSON(ANNOUNCEMENTS_FILE);
        const attendanceList = readJSON(ATTENDANCE_FILE);
        const clubs = readAllClubs();

        console.log(`   📋 Found ${members.length} members`);
        console.log(`   🏛️  Found ${clubs.length} clubs`);
        console.log(`   📅 Found ${events.length} events`);
        console.log(`   📢 Found ${announcements.length} announcements`);
        console.log(`   ✅ Found ${attendanceList.length} attendance records\n`);

        // Step 3: Create Club Owners
        console.log('👑 Step 3: Creating club owners...');
        const ownerMap = {};
        for (const club of clubs) {
            if (club.owner) {
                let passwordHash = club.owner.password;
                // if (!passwordHash.startsWith('$2a$') && !passwordHash.startsWith('$2b$')) {
                //    passwordHash = await bcrypt.hash(club.owner.password, 10);
                // }
                const [owner] = await User.findOrCreate({
                    where: { email: club.owner.email },
                    defaults: {
                        studentId: club.owner.studentId || `OWNER${club.id}`,
                        username: club.owner.username,
                        email: club.owner.email,
                        password: passwordHash,
                        role: 'owner'
                    }
                });
                ownerMap[club.owner.username] = owner.id;
            }
        }
        console.log('   ✅ Owners created.\n');

        // Step 4: Create Members
        console.log('👥 Step 4: Creating members...');
        const memberMap = {}; // old ID -> new ID
        for (const member of members) {
            let passwordHash = member.password;
            // if (!passwordHash.startsWith('$2a$') && !passwordHash.startsWith('$2b$')) {
            //    passwordHash = await bcrypt.hash(member.password, 10);
            // }
            const [user] = await User.findOrCreate({
                where: { email: member.email },
                defaults: {
                    studentId: member.studentId,
                    username: member.username,
                    email: member.email,
                    password: passwordHash,
                    role: 'member',
                    profilePic: member.profile?.pic || '',
                    bio: member.profile?.bio || '',
                    phone: member.profile?.phone || '',
                    department: member.profile?.department || ''
                }
            });
            memberMap[member.id] = user.id;
        }
        console.log('   ✅ Members created.\n');

        // Step 5: Create Clubs
        console.log('🏛️  Step 5: Creating clubs...');
        const clubMap = {}; // old ID -> new ID
        for (const clubData of clubs) {
            const ownerId = clubData.owner ? ownerMap[clubData.owner.username] : null;
            const [club] = await Club.findOrCreate({
                where: { name: clubData.name },
                defaults: {
                    name: clubData.name,
                    tagline: clubData.tagline || '',
                    themeColor: clubData.themeColor || '#000000',
                    logo: clubData.logo || '',
                    description: '',
                    ownerId: ownerId
                }
            });
            clubMap[clubData.id] = club.id;
        }
        console.log('   ✅ Clubs created.\n');

        // Step 6: Create Memberships
        console.log('🔗 Step 6: Creating memberships...');
        for (const member of members) {
            if (member.clubs && member.clubs.length > 0) {
                for (const oldClubId of member.clubs) {
                    const newUserId = memberMap[member.id];
                    const newClubId = clubMap[oldClubId];
                    if (newUserId && newClubId) {
                        const clubIdStr = oldClubId.toString();
                        const points = (member.clubPoints && member.clubPoints[clubIdStr]) || 0;
                        const rank = (member.clubRanks && member.clubRanks[clubIdStr]) || 'Rookie';
                        await Membership.findOrCreate({
                            where: { userId: newUserId, clubId: newClubId },
                            defaults: { userId: newUserId, clubId: newClubId, points, rank, status: 'active' }
                        });
                    }
                }
            }
        }
        console.log('   ✅ Memberships created.\n');

        // Step 7: Create Events
        console.log('📅 Step 7: Creating events...');
        const eventMap = {}; // old ID -> new ID
        for (const eventData of events) {
            const newClubId = clubMap[eventData.clubId];
            if (newClubId) {
                const [event] = await Event.findOrCreate({
                    where: { title: eventData.title, clubId: newClubId },
                    defaults: {
                        title: eventData.title,
                        date: eventData.date,
                        venue: eventData.venue || '',
                        description: eventData.description || '',
                        qrCode: eventData.qrCode || '',
                        rsvpList: JSON.stringify(eventData.rsvpList || []), // Keep rsvpList as JSON string for now
                        clubId: newClubId
                    }
                });
                eventMap[eventData.id] = event.id;
            }
        }
        console.log('   ✅ Events created.\n');

        // Step 8: Create Announcements
        console.log('📢 Step 8: Creating announcements...');
        for (const ann of announcements) {
            const newClubId = clubMap[ann.clubId];
            if (newClubId) { // Only migration if club exists
                await Announcement.create({
                    title: ann.title,
                    message: ann.message,
                    date: ann.date,
                    clubId: newClubId,
                    createdBy: ann.createdBy
                });
            }
        }
        console.log('   ✅ Announcements created.\n');

        // Step 9: Create Attendance Records
        console.log('✅ Step 9: Creating attendance records...');
        for (const att of attendanceList) {
            const newEventId = eventMap[att.eventId];
            const newUserId = memberMap[att.memberId];

            if (newEventId && newUserId) {
                await Attendance.create({
                    eventId: newEventId,
                    userId: newUserId,
                    status: att.status || 'present',
                    timestamp: att.timestamp
                });
            }
        }
        console.log('   ✅ Attendance records created.\n');

        // Final Summary
        console.log('╔════════════════════════════════════════════════╗');
        console.log('║          🎉 MIGRATION COMPLETE!                ║');
        console.log('╚════════════════════════════════════════════════╝');
        console.log(`\nStats:`);
        console.log(`   Use, Clb, Evt, Ann, Att`);
        console.log(`   ${await User.count()}, ${await Club.count()}, ${await Event.count()}, ${await Announcement.count()}, ${await Attendance.count()}`);

    } catch (error) {
        console.error('\n❌ MIGRATION FAILED!', error);
    } finally {
        await sequelize.close();
    }
}

// Run migration
migrateData();
