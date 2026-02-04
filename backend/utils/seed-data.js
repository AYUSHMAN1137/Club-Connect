const { sequelize, User, Club, Membership, Announcement, Event, EventRSVP, PointHistory, Notification, ClubOwner } = require('../models');
// const bcrypt = require('bcryptjs');

async function seedData() {
    try {
        console.log('🌱 Seeding Database...');
        await sequelize.sync({ force: true }); // Reset DB

        // 1. Create Users
        const passwordHash = '123'; // Plain text password

        const owner1 = await User.create({ username: 'IEEE_Owner', email: 'ieee@example.com', password: passwordHash, role: 'owner', studentId: 'OWN1' });
        const owner2 = await User.create({ username: 'Utopia_Owner', email: 'utopia@example.com', password: passwordHash, role: 'owner', studentId: 'OWN2' });

        const member1 = await User.create({ username: 'Ayushman', email: 'ayush@example.com', password: passwordHash, role: 'member', studentId: '1137', phone: '9999999999' });
        const member2 = await User.create({ username: 'Muskan', email: 'muskan@example.com', password: passwordHash, role: 'member', studentId: '1138' });

        // 2. Create Clubs
        const club1 = await Club.create({ name: 'IEEE', tagline: 'Tech for Humanity', themeColor: '#00629B', ownerId: owner1.id });
        const club2 = await Club.create({ name: 'Utopia', tagline: 'Innovation Hub', themeColor: '#FFC800', ownerId: owner2.id });
        await ClubOwner.create({ userId: owner1.id, clubId: club1.id });
        await ClubOwner.create({ userId: owner2.id, clubId: club2.id });

        // 3. Create Memberships
        await Membership.create({ userId: member1.id, clubId: club1.id, points: 100, rank: 'Bronze', status: 'active' });
        await Membership.create({ userId: member1.id, clubId: club2.id, points: 50 }); // Joined 2 clubs
        await Membership.create({ userId: member2.id, clubId: club1.id, points: 20 });

        // 4. Create Events
        const event1 = await Event.create({
            title: 'Hackathon 2026',
            date: new Date(Date.now() + 86400000), // Tomorrow
            description: 'Coding Battle',
            clubId: club1.id,
            venue: 'Main Hall'
        });

        // 5. RSVP
        await EventRSVP.create({ eventId: event1.id, userId: member1.id, status: 'going' });

        // 6. Announcements
        await Announcement.create({
            title: 'Welcome to IEEE',
            message: 'We are glad to have you!',
            clubId: club1.id,
            date: new Date()
        });

        // 7. Notifications
        await Notification.create({
            userId: member1.id,
            title: 'Welcome!',
            message: 'Your account is ready.',
            type: 'system'
        });

        console.log('✅ Database Seeded Successfully!');
        console.log('Login: Ayushman / 123');
        console.log('Owner: IEEE_Owner / 123');

    } catch (error) {
        console.error('❌ Seeding Failed:', error);
    } finally {
        await sequelize.close();
    }
}

seedData();
