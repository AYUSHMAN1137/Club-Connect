/**
 * Sync Routes — bootstrap, manifest, module, version bumping
 *
 * Provides endpoints for the local-first caching system:
 *   GET  /member/sync-manifest   — module versions for member dashboard
 *   GET  /owner/sync-manifest    — module versions for owner dashboard
 *   GET  /member/module/:name    — single member module payload
 *   GET  /owner/module/:name     — single owner module payload
 *
 * Also exports helpers used by server.js mutation endpoints:
 *   bumpModuleVersions(clubId, moduleNames)
 *   invalidateModules(io, clubId, moduleNames)
 */

const express = require('express');

// All recognised module names per role
const MEMBER_MODULES = [
    'dashboard', 'events', 'attendance', 'leaderboard',
    'announcements', 'polls', 'myProjects', 'profile',
    'certificates', 'notifications', 'messagesContacts'
];

const OWNER_MODULES = [
    'dashboardStats', 'members', 'events', 'announcements',
    'polls', 'certificates', 'projectProgress', 'analytics',
    'workshops', 'notifications', 'messagesContacts'
];

/**
 * Factory — call with dependencies and get back {router, helpers}.
 */
module.exports = function createSyncRouter({ verifyToken, isMember, isOwner, db, SyncState }) {

    const router = express.Router();

    // ───────── helpers exposed to server.js ─────────

    /**
     * Bump version counters for the given modules inside a club.
     * Creates rows on first touch (upsert).
     */
    async function bumpModuleVersions(clubId, moduleNames) {
        if (!clubId || !moduleNames || !moduleNames.length) return;
        const now = new Date();
        for (const mod of moduleNames) {
            try {
                const [state, created] = await SyncState.findOrCreate({
                    where: { clubId, module: mod },
                    defaults: { version: 1, updatedAt: now }
                });
                if (!created) {
                    state.version += 1;
                    state.updatedAt = now;
                    await state.save();
                }
            } catch (err) {
                console.error(`⚠️ bumpModuleVersions failed for ${mod}:`, err.message);
            }
        }
    }

    /**
     * Convenience: bump versions AND emit socket invalidation event.
     */
    function invalidateModules(io, clubId, moduleNames) {
        if (!clubId || !moduleNames || !moduleNames.length) return;
        bumpModuleVersions(clubId, moduleNames).catch(() => { });
        if (io) {
            io.to(`club-${clubId}`).emit('module-invalidated', {
                modules: moduleNames,
                clubId,
                timestamp: Date.now()
            });
        }
    }

    // ───────── internal: build manifest ─────────

    async function buildManifest(clubId, moduleList) {
        const rows = await SyncState.findAll({ where: { clubId } });
        const versions = {};
        // Initialise every module to version 0 (never-synced)
        moduleList.forEach(m => { versions[m] = 0; });
        rows.forEach(r => {
            if (moduleList.includes(r.module)) {
                versions[r.module] = r.version;
            }
        });
        return {
            versions,
            generatedAt: new Date().toISOString(),
            clubId
        };
    }

    // ───────── internal: resolve club for member / owner ─────────

    async function resolveOwnerClub(userId) {
        return db.findClubByOwnerId(userId);
    }

    async function resolveMemberClub(userId) {
        const member = await db.findUserById(userId);
        if (!member) return null;
        const clubs = await db.getUserClubs(userId);
        if (!clubs || clubs.length === 0) return null;
        let activeClubId = member.activeClubId;
        if (!activeClubId || !clubs.some(c => c.id === activeClubId)) {
            activeClubId = clubs[0].id;
        }
        return clubs.find(c => c.id === activeClubId) || clubs[0];
    }

    // ───────── member manifest ─────────

    router.get('/member/sync-manifest', verifyToken, isMember, async (req, res) => {
        try {
            const club = await resolveMemberClub(req.user.id);
            if (!club) return res.json({ success: true, versions: {}, generatedAt: new Date().toISOString() });
            const manifest = await buildManifest(club.id, MEMBER_MODULES);
            res.json({ success: true, ...manifest });
        } catch (err) {
            console.error('sync-manifest (member) error:', err);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    // ───────── owner manifest ─────────

    router.get('/owner/sync-manifest', verifyToken, isOwner, async (req, res) => {
        try {
            const club = await resolveOwnerClub(req.user.id);
            if (!club) return res.json({ success: true, versions: {}, generatedAt: new Date().toISOString() });
            const manifest = await buildManifest(club.id, OWNER_MODULES);
            res.json({ success: true, ...manifest });
        } catch (err) {
            console.error('sync-manifest (owner) error:', err);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    // ───────── single module fetch (member) ─────────

    router.get('/member/module/:name', verifyToken, isMember, async (req, res) => {
        try {
            const moduleName = req.params.name;
            if (!MEMBER_MODULES.includes(moduleName)) {
                return res.status(400).json({ success: false, message: `Unknown module: ${moduleName}` });
            }
            const club = await resolveMemberClub(req.user.id);
            if (!club) return res.json({ success: true, data: null });

            const data = await fetchMemberModuleData(req.user.id, club.id, moduleName, db);
            const state = await SyncState.findOne({ where: { clubId: club.id, module: moduleName } });
            const version = state ? state.version : 0;

            res.json({ success: true, module: moduleName, version, data });
        } catch (err) {
            console.error(`module fetch (member/${req.params.name}) error:`, err);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    // ───────── single module fetch (owner) ─────────

    router.get('/owner/module/:name', verifyToken, isOwner, async (req, res) => {
        try {
            const moduleName = req.params.name;
            if (!OWNER_MODULES.includes(moduleName)) {
                return res.status(400).json({ success: false, message: `Unknown module: ${moduleName}` });
            }
            const club = await resolveOwnerClub(req.user.id);
            if (!club) return res.json({ success: true, data: null });

            const data = await fetchOwnerModuleData(req.user.id, club.id, moduleName, db);
            const state = await SyncState.findOne({ where: { clubId: club.id, module: moduleName } });
            const version = state ? state.version : 0;

            res.json({ success: true, module: moduleName, version, data });
        } catch (err) {
            console.error(`module fetch (owner/${req.params.name}) error:`, err);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    // ────────────────────────────────────────────────
    // Module data fetchers — lightweight DB queries
    // that mirror the individual API endpoints.
    // ────────────────────────────────────────────────

    async function fetchMemberModuleData(userId, clubId, moduleName, db) {
        switch (moduleName) {
            case 'events': {
                const events = await db.getClubEvents(clubId);
                return {
                    success: true,
                    events: events.map(e => ({
                        ...e,
                        hasRsvped: e.rsvpList && e.rsvpList.includes(userId),
                        hasAttended: e.attendanceList && e.attendanceList.includes(userId)
                    }))
                };
            }
            case 'attendance': {
                const history = await db.getUserAttendanceHistory(userId);
                return {
                    success: true,
                    attendance: history.map(a => ({
                        id: a.id,
                        eventTitle: a.eventTitle || a.Event?.title || 'Unknown Event',
                        eventDate: a.eventDate || a.Event?.date || '',
                        timestamp: a.timestamp || a.createdAt
                    }))
                };
            }
            case 'leaderboard': {
                const members = await db.getClubMembers(clubId);
                return {
                    success: true,
                    leaderboard: (members || [])
                        .map(m => ({ id: m.id, username: m.username, points: m.points || 0, profilePic: m.profilePic || '' }))
                        .sort((a, b) => b.points - a.points)
                };
            }
            case 'announcements': {
                const anns = await db.getClubAnnouncements(clubId);
                return { success: true, announcements: anns || [] };
            }
            case 'polls': {
                const polls = await db.getClubPolls(clubId, { userId });
                return { success: true, polls: polls || [] };
            }
            case 'notifications': {
                const notifs = await db.Notification.findAll({
                    where: { userId },
                    order: [['createdAt', 'DESC']],
                    limit: 50
                });
                return { success: true, notifications: notifs || [] };
            }
            case 'certificates': {
                const certs = await db.MemberCertificate.findAll({
                    where: { memberId: userId },
                    order: [['createdAt', 'DESC']]
                });
                return { success: true, certificates: certs || [] };
            }
            case 'profile': {
                const user = await db.findUserById(userId);
                if (!user) return { success: false };
                const plain = user.toJSON ? user.toJSON() : { ...user };
                delete plain.password;
                return { success: true, profile: plain };
            }
            case 'dashboard': {
                // Lightweight summary — detailed data comes from leaderboard + attendance modules
                const member = await db.findUserById(userId);
                const clubs = await db.getUserClubs(userId);
                const activeClub = clubs.find(c => c.id === clubId) || clubs[0];
                if (!activeClub) return { success: true, dashboard: { hasNoClub: true } };
                const events = await db.getClubEvents(clubId);
                const today = new Date().toISOString().split('T')[0];
                const upcomingEvents = events.filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
                let totalPoints = 0;
                clubs.forEach(c => totalPoints += c.points || 0);
                return {
                    success: true,
                    dashboard: {
                        clubName: activeClub.name || '',
                        totalPoints,
                        totalEvents: events.length,
                        upcomingEvents: upcomingEvents.length,
                        hasNoClub: false,
                        status: activeClub.status || 'active'
                    }
                };
            }
            case 'messagesContacts': {
                // Return lightweight contact list
                const contacts = await db.Message.findAll({
                    where: { [db.sequelize.constructor.Op.or]: [{ senderId: userId }, { recipientId: userId }] },
                    attributes: ['senderId', 'recipientId'],
                    group: ['senderId', 'recipientId'],
                    raw: true
                });
                const contactIds = new Set();
                contacts.forEach(c => {
                    if (c.senderId !== userId) contactIds.add(c.senderId);
                    if (c.recipientId !== userId) contactIds.add(c.recipientId);
                });
                return { success: true, contactIds: [...contactIds] };
            }
            default:
                return { success: true, data: null };
        }
    }

    async function fetchOwnerModuleData(userId, clubId, moduleName, db) {
        switch (moduleName) {
            case 'dashboardStats': {
                const club = await db.Club.findByPk(clubId);
                const members = await db.getClubMembers(clubId);
                const events = await db.getClubEvents(clubId);
                return {
                    success: true,
                    stats: {
                        totalMembers: members.length,
                        totalEvents: events.length,
                        clubName: club ? club.name : '',
                        clubId
                    },
                    members: { success: true, members },
                    events: { success: true, events }
                };
            }
            case 'members': {
                const members = await db.getClubMembers(clubId);
                return { success: true, members: members || [] };
            }
            case 'events': {
                const events = await db.getClubEvents(clubId);
                return { success: true, events: events || [] };
            }
            case 'announcements': {
                const anns = await db.getClubAnnouncements(clubId);
                return { success: true, announcements: anns || [] };
            }
            case 'polls': {
                const polls = await db.getClubPolls(clubId);
                return { success: true, polls: polls || [] };
            }
            case 'certificates': {
                const certs = await db.MemberCertificate.findAll({
                    where: { clubId },
                    order: [['createdAt', 'DESC']]
                });
                return { success: true, certificates: certs || [] };
            }
            case 'projectProgress': {
                const projects = await db.MemberProject.findAll({
                    where: { clubId },
                    include: [
                        { model: db.User, attributes: ['id', 'username'] },
                        { model: db.ProjectIdea, attributes: ['id', 'title'] }
                    ],
                    order: [['updatedAt', 'DESC']]
                });
                return { success: true, projects: projects || [] };
            }
            case 'analytics': {
                // Lightweight analytics payload
                const members = await db.getClubMembers(clubId);
                const events = await db.getClubEvents(clubId);
                const polls = await db.getClubPolls(clubId);
                return {
                    success: true,
                    analytics: {
                        totalMembers: members.length,
                        totalEvents: events.length,
                        totalPolls: polls ? polls.length : 0
                    }
                };
            }
            case 'workshops': {
                const workshops = await db.Workshop.findAll({
                    where: { clubId },
                    order: [['createdAt', 'DESC']]
                });
                return { success: true, workshops: workshops || [] };
            }
            case 'notifications': {
                const notifs = await db.Notification.findAll({
                    where: { userId },
                    order: [['createdAt', 'DESC']],
                    limit: 50
                });
                return { success: true, notifications: notifs || [] };
            }
            case 'messagesContacts': {
                const contacts = await db.Message.findAll({
                    where: { [db.sequelize.constructor.Op.or]: [{ senderId: userId }, { recipientId: userId }] },
                    attributes: ['senderId', 'recipientId'],
                    group: ['senderId', 'recipientId'],
                    raw: true
                });
                const contactIds = new Set();
                contacts.forEach(c => {
                    if (c.senderId !== userId) contactIds.add(c.senderId);
                    if (c.recipientId !== userId) contactIds.add(c.recipientId);
                });
                return { success: true, contactIds: [...contactIds] };
            }
            default:
                return { success: true, data: null };
        }
    }

    return {
        router,
        bumpModuleVersions,
        invalidateModules,
        MEMBER_MODULES,
        OWNER_MODULES
    };
};
