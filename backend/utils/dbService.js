/**
 * 🗄️ DATABASE SERVICE
 * Provides clean functions to interact with SQLite database
 * This replaces all JSON file operations
 */

const {
    User,
    Club,
    Event,
    Membership,
    Announcement,
    Attendance,
    EventRSVP,
    PointHistory,
    Notification,
    Message,
    GalleryPhoto,
    MemberCertificate,
    Poll,
    PollOption,
    PollVote,
    ProjectIdea,
    MemberProject,
    MemberProjectHistory,
    AttendanceSession,
    AttendanceRecord,
    ClubOwner,
    sequelize
} = require('../models');
const { Op } = require('sequelize');

// ========== USER FUNCTIONS ==========

/**
 * Find user by username (case-insensitive)
 */
async function findUserByUsername(username) {
    return await User.findOne({
        where: sequelize.where(
            sequelize.fn('LOWER', sequelize.col('username')),
            sequelize.fn('LOWER', username)
        )
    });
}

/**
 * Find user by email
 */
async function findUserByEmail(email) {
    return await User.findOne({
        where: { email: email.toLowerCase() }
    });
}

/**
 * Find user by ID
 */
async function findUserById(id) {
    return await User.findByPk(id);
}

/**
 * Find user by studentId
 */
async function findUserByStudentId(studentId) {
    return await User.findOne({ where: { studentId } });
}

/**
 * Create new user (member)
 */
async function createUser(userData) {
    return await User.create({
        studentId: userData.studentId,
        username: userData.username,
        email: userData.email.toLowerCase(),
        password: userData.password,
        role: userData.role || 'member',
        profilePic: userData.profilePic || '',
        bio: userData.bio || '',
        phone: userData.phone || '',
        department: userData.department || ''
    });
}

/**
 * Update user by ID
 */
async function updateUser(id, updates) {
    const user = await User.findByPk(id);
    if (user) {
        await user.update(updates);
        return user;
    }
    return null;
}

/**
 * Get all users
 */
async function getAllUsers() {
    return await User.findAll();
}

/**
 * Check if user exists (by email, username, or studentId)
 */
async function userExists(email, username, studentId) {
    const orConditions = [];

    if (email) {
        orConditions.push({ email: String(email).toLowerCase() });
    }

    if (username) {
        orConditions.push(
            sequelize.where(
                sequelize.fn('LOWER', sequelize.col('username')),
                sequelize.fn('LOWER', String(username))
            )
        );
    }

    if (studentId) {
        orConditions.push({ studentId: String(studentId) });
    }

    if (orConditions.length === 0) return false;

    const user = await User.findOne({ where: { [Op.or]: orConditions } });
    return user !== null;
}

// ========== CLUB FUNCTIONS ==========

/**
 * Get all clubs
 */
async function getAllClubs() {
    return await Club.findAll({
        include: [
            { model: User, as: 'Owner', attributes: ['id', 'username', 'email'] },
            { model: User, as: 'Owners', attributes: ['id', 'username', 'email'], through: { attributes: [] } }
        ]
    });
}

/**
 * Find club by ID
 */
async function findClubById(id) {
    return await Club.findByPk(id, {
        include: [
            { model: User, as: 'Owner', attributes: ['id', 'username', 'email'] },
            { model: User, as: 'Owners', attributes: ['id', 'username', 'email'], through: { attributes: [] } }
        ]
    });
}

/**
 * Find club by owner ID
 */
async function findClubByOwnerId(ownerId) {
    const directClub = await Club.findOne({
        where: { ownerId },
        include: [
            { model: User, as: 'Owner', attributes: ['id', 'username', 'email'] },
            { model: User, as: 'Owners', attributes: ['id', 'username', 'email'], through: { attributes: [] } }
        ]
    });
    if (directClub) {
        return directClub;
    }
    const ownerLink = await ClubOwner.findOne({ where: { userId: ownerId } });
    if (!ownerLink) {
        return null;
    }
    return await Club.findByPk(ownerLink.clubId, {
        include: [
            { model: User, as: 'Owner', attributes: ['id', 'username', 'email'] },
            { model: User, as: 'Owners', attributes: ['id', 'username', 'email'], through: { attributes: [] } }
        ]
    });
}

/**
 * Create new club
 */
async function createClub(clubData) {
    const club = await Club.create({
        name: clubData.name,
        tagline: clubData.tagline || '',
        themeColor: clubData.themeColor || '#000000',
        logo: clubData.logo || '',
        description: clubData.description || '',
        ownerId: clubData.ownerId
    });
    await ClubOwner.findOrCreate({
        where: { clubId: club.id, userId: clubData.ownerId },
        defaults: { clubId: club.id, userId: clubData.ownerId }
    });
    return club;
}

/**
 * Update club by ID
 */
async function updateClub(id, updates) {
    const club = await Club.findByPk(id);
    if (club) {
        await club.update(updates);
        return club;
    }
    return null;
}

async function addOwnerToClub(userId, clubId) {
    const [ownerLink, created] = await ClubOwner.findOrCreate({
        where: { userId, clubId },
        defaults: { userId, clubId }
    });
    return { ownerLink, created };
}

// ========== MEMBERSHIP FUNCTIONS ==========

/**
 * Get all members of a club
 */
async function getClubMembers(clubId) {
    const memberships = await Membership.findAll({
        where: { clubId },
        include: [{
            model: User,
            attributes: ['id', 'studentId', 'username', 'email', 'profilePic', 'bio', 'phone', 'department']
        }]
    });

    return memberships.map(m => ({
        id: m.User.id,
        studentId: m.User.studentId,
        username: m.User.username,
        email: m.User.email,
        points: m.points,
        rank: m.rank,
        status: m.status,
        joinedAt: m.joinedAt,
        profile: {
            pic: m.User.profilePic,
            bio: m.User.bio,
            phone: m.User.phone,
            department: m.User.department
        }
    }));
}

/**
 * Get all clubs a user is member of
 */
async function getUserClubs(userId) {
    const memberships = await Membership.findAll({
        where: { userId },
        include: [{
            model: Club,
            attributes: ['id', 'name', 'tagline', 'themeColor', 'logo']
        }]
    });

    return memberships.map(m => ({
        id: m.Club.id,
        name: m.Club.name,
        tagline: m.Club.tagline,
        themeColor: m.Club.themeColor,
        logo: m.Club.logo,
        points: m.points,
        rank: m.rank,
        status: m.status,
        joinedAt: m.joinedAt
    }));
}

/**
 * Add member to club
 */
async function addMemberToClub(userId, clubId, points = 0, rank = 'Rookie') {
    const [membership, created] = await Membership.findOrCreate({
        where: { userId, clubId },
        defaults: { userId, clubId, points, rank, status: 'active' }
    });
    return { membership, created };
}

/**
 * Remove member from club
 */
async function removeMemberFromClub(userId, clubId) {
    await archiveMemberProjectsForUser(userId, clubId);
    const deleted = await Membership.destroy({
        where: { userId, clubId }
    });
    return deleted > 0;
}

/**
 * Update membership (points, rank, etc.)
 */
async function updateMembership(userId, clubId, updates) {
    const membership = await Membership.findOne({
        where: { userId, clubId }
    });
    if (membership) {
        await membership.update(updates);
        return membership;
    }
    return null;
}

/**
 * Get membership details
 */
async function getMembership(userId, clubId) {
    return await Membership.findOne({
        where: { userId, clubId }
    });
}



// ========== EVENT FUNCTIONS ==========

/**
 * Get all events for a club
 * Uses EventRSVP table instead of deprecated rsvpList JSON
 */
async function getClubEvents(clubId) {
    const events = await Event.findAll({
        where: { clubId },
        include: [
            {
                model: EventRSVP,
                attributes: ['userId', 'status']
            },
            {
                model: Attendance,
                attributes: ['userId', 'status']
            }
        ],
        order: [['date', 'DESC']]
    });

    // Build rsvpList and attendanceList for backward compatibility
    return events.map(e => {
        const event = e.toJSON();
        event.rsvpList = event.EventRSVPs?.map(r => r.userId) || [];
        event.rsvpCount = event.rsvpList.length;
        event.attendanceList = event.Attendances?.map(a => a.userId) || [];
        event.attendedCount = event.attendanceList.length;
        delete event.EventRSVPs;
        delete event.Attendances;
        return event;
    });
}

/**
 * Find event by ID
 */
/**
 * Find event by ID
 */
async function findEventById(id) {
    const event = await Event.findByPk(id, {
        include: [{
            model: EventRSVP,
            attributes: ['userId', 'status', 'timestamp']
        }]
    });
    if (event) {
        const e = event.toJSON();
        // Backward compatibility for frontend which expects 'rsvpList' array of userIds
        e.rsvpList = e.EventRSVPs ? e.EventRSVPs.map(r => r.userId) : [];
        return e;
    }
    return null;
}

/**
 * RSVP to event
 */
async function rsvpToEvent(eventId, userId) {
    const event = await Event.findByPk(eventId);
    if (!event) return null;

    try {
        await EventRSVP.findOrCreate({
            where: { eventId, userId },
            defaults: { status: 'going', timestamp: new Date() }
        });
        return true;
    } catch (error) {
        console.error("RSVP Error:", error);
        return false;
    }
}

/**
 * Create new event
 * Supports new fields: startTime, endTime, capacity, status
 */
async function createEvent(eventData) {
    return await Event.create({
        title: eventData.title,
        date: eventData.date,
        startTime: eventData.startTime || null,
        endTime: eventData.endTime || null,
        venue: eventData.venue || '',
        description: eventData.description || '',
        qrCode: eventData.qrCode || '',
        capacity: eventData.capacity || null,
        status: eventData.status || 'upcoming',
        clubId: eventData.clubId
    });
}

/**
 * Update event
 */
async function updateEvent(id, updates) {
    const event = await Event.findByPk(id);
    if (event) {
        await event.update(updates);
        return event;
    }
    return null;
}

/**
 * Delete event
 */
async function deleteEvent(id) {
    const deleted = await Event.destroy({ where: { id } });
    return deleted > 0;
}

// ========== LEADERBOARD FUNCTIONS ==========

/**
 * Get club leaderboard (top members by points)
 */
async function getClubLeaderboard(clubId, limit = 10) {
    const memberships = await Membership.findAll({
        where: { clubId },
        include: [{
            model: User,
            attributes: ['id', 'username', 'profilePic']
        }],
        order: [['points', 'DESC']],
        limit
    });

    return memberships.map((m, index) => ({
        rank: index + 1,
        id: m.User.id,
        username: m.User.username,
        profilePic: m.User.profilePic,
        points: m.points,
        badge: m.rank
    }));
}

// ========== STATS FUNCTIONS ==========

// ========== POINTS & NOTIFICATIONS ==========

/**
 * Award points with audit trail and notification.
 * Can run inside an existing transaction (options.transaction) or create its own.
 */
async function awardPoints(userId, clubId, points, reason, performedBy = 'System', options = {}) {
    const externalTx = options.transaction || null;
    const t = externalTx || await sequelize.transaction();

    try {
        // 1. Update Membership
        const membership = await Membership.findOne({ where: { userId, clubId }, transaction: t });
        if (!membership) throw new Error('Membership not found');

        const newPoints = (membership.points || 0) + points;

        // Calculate new rank
        let newRank = 'Rookie';
        if (newPoints >= 500) newRank = 'Platinum';
        else if (newPoints >= 300) newRank = 'Gold';
        else if (newPoints >= 150) newRank = 'Silver';
        else if (newPoints >= 50) newRank = 'Bronze';

        await membership.update({ points: newPoints, rank: newRank }, { transaction: t });

        // 2. Add History
        await PointHistory.create({
            userId,
            clubId,
            points,
            reason,
            performedBy
        }, { transaction: t });

        // 3. Notify User
        await Notification.create({
            userId,
            title: 'Points Awarded! 🎉',
            message: `You received ${points} points for "${reason}". Total: ${newPoints}`,
            type: 'points'
        }, { transaction: t });

        if (!externalTx) {
            await t.commit();
        }
        return { success: true, newPoints, newRank };
    } catch (error) {
        if (!externalTx) {
            await t.rollback();
        }
        console.error('Error awarding points:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Atomically mark attendance and award points in a single transaction.
 */
async function markAttendanceWithPoints(eventId, userId, clubId, points, reason, performedBy = 'System') {
    const t = await sequelize.transaction();
    try {
        // 1. Ensure attendance exists
        await Attendance.findOrCreate({
            where: { eventId, userId },
            defaults: { status: 'present' },
            transaction: t
        });

        // 2. Award points within the same transaction
        const result = await awardPoints(userId, clubId, points, reason, performedBy, { transaction: t });
        if (!result.success) {
            throw new Error(result.error || 'Failed to award points');
        }

        await t.commit();
        return { success: true, newPoints: result.newPoints, newRank: result.newRank };
    } catch (error) {
        await t.rollback();
        console.error('Error in markAttendanceWithPoints:', error);
        return { success: false, error: error.message };
    }
}

async function getNotifications(userId) {
    return await Notification.findAll({
        where: { userId },
        order: [['createdAt', 'DESC']],
        limit: 20
    });
}

// ========== ANNOUNCEMENT FUNCTIONS ==========
async function getAnnouncementsForUser(userId) {
    const userClubs = await getUserClubs(userId);
    const clubIds = userClubs.map(c => c.id);

    // Get announcements where clubId is in user's clubs OR clubId is null (global)
    return await Announcement.findAll({
        where: {
            [Op.or]: [
                { clubId: { [Op.in]: clubIds } },
                { clubId: null }
            ]
        },
        order: [['date', 'DESC']]
    });
}

// ========== POLL FUNCTIONS ==========

/**
 * Create a poll with options for a club
 */
async function createPoll(clubId, createdById, question, options, endDate = null) {
    const t = await sequelize.transaction();
    try {
        const poll = await Poll.create(
            { clubId, createdById, question, status: 'active', endDate },
            { transaction: t }
        );
        const optionRecords = options
            .filter(t => t && String(t).trim())
            .map((text, index) => ({ pollId: poll.id, text: String(text).trim(), order: index }));
        if (optionRecords.length < 2) {
            await t.rollback();
            throw new Error('Poll must have at least 2 options');
        }
        await PollOption.bulkCreate(optionRecords, { transaction: t });
        await t.commit();
        return poll;
    } catch (err) {
        await t.rollback();
        throw err;
    }
}

/**
 * Get all polls for a club (for owner)
 */
async function getPollsByClubId(clubId) {
    return await Poll.findAll({
        where: { clubId },
        include: [
            { model: PollOption, as: 'Options', attributes: ['id', 'text', 'order'], order: [['order', 'ASC']] },
            { model: User, as: 'Creator', attributes: ['id', 'username'] }
        ],
        order: [['createdAt', 'DESC']]
    });
}

/**
 * Get a single poll by ID with options and vote counts
 */
async function getPollById(pollId, options = {}) {
    const { includeVoteCounts = true, userId = null } = options;
    const poll = await Poll.findByPk(pollId, {
        include: [
            { model: PollOption, as: 'Options', attributes: ['id', 'text', 'order'], order: [['order', 'ASC']] },
            { model: User, as: 'Creator', attributes: ['id', 'username'] },
            { model: Club, attributes: ['id', 'name'] }
        ]
    });
    if (!poll) return null;
    const p = poll.toJSON();
    const opts = (p.Options || []).sort((a, b) => (a.order || 0) - (b.order || 0));
    if (includeVoteCounts) {
        const votes = await PollVote.findAll({ where: { pollId }, attributes: ['optionId'] });
        const countByOption = {};
        votes.forEach(v => { countByOption[v.optionId] = (countByOption[v.optionId] || 0) + 1; });
        p.options = opts.map(opt => ({
            id: opt.id,
            text: opt.text,
            order: opt.order,
            voteCount: countByOption[opt.id] || 0
        }));
        p.totalVotes = votes.length;
    } else {
        p.options = opts;
    }
    delete p.Options;
    if (userId !== undefined && userId !== null) {
        const myVote = await PollVote.findOne({ where: { pollId, userId }, attributes: ['optionId'] });
        p.userVotedOptionId = myVote ? myVote.optionId : null;
    }
    return p;
}

/**
 * Get polls for clubs the member belongs to (by default first club, or pass clubId)
 */
async function getPollsForMember(userId, clubId = null) {
    const clubs = await getUserClubs(userId);
    if (!clubs || clubs.length === 0) return [];
    const targetClubId = clubId || clubs[0].id;
    const isMember = await getMembership(userId, targetClubId);
    if (!isMember) return [];
    const polls = await Poll.findAll({
        where: { clubId: targetClubId },
        include: [{ model: PollOption, as: 'Options', attributes: ['id', 'text', 'order'] }],
        order: [['createdAt', 'DESC']]
    });
    const result = [];
    for (const poll of polls) {
        const p = poll.toJSON();
        const votes = await PollVote.findAll({ where: { pollId: poll.id }, attributes: ['optionId'] });
        const countByOption = {};
        votes.forEach(v => { countByOption[v.optionId] = (countByOption[v.optionId] || 0) + 1; });
        const sortedOpts = (p.Options || []).sort((a, b) => (a.order || 0) - (b.order || 0));
        p.options = sortedOpts.map(opt => ({
            id: opt.id,
            text: opt.text,
            order: opt.order,
            voteCount: countByOption[opt.id] || 0
        }));
        p.totalVotes = votes.length;
        const myVote = await PollVote.findOne({ where: { pollId: poll.id, userId }, attributes: ['optionId'] });
        p.userVotedOptionId = myVote ? myVote.optionId : null;
        delete p.Options;
        result.push(p);
    }
    return result;
}

/**
 * Vote in a poll (one vote per user per poll). User must be member of the club.
 */
async function votePoll(pollId, optionId, userId) {
    const poll = await Poll.findByPk(pollId, { include: [{ model: PollOption, as: 'Options' }] });
    if (!poll) return { success: false, message: 'Poll not found' };
    if (poll.status !== 'active') return { success: false, message: 'Poll is closed' };
    const membership = await getMembership(userId, poll.clubId);
    if (!membership) return { success: false, message: 'Not a member of this club' };
    const option = (poll.Options || []).find(o => o.id === optionId);
    if (!option) return { success: false, message: 'Invalid option' };
    const existing = await PollVote.findOne({ where: { pollId, userId } });
    if (existing) return { success: false, message: 'You have already voted' };
    await PollVote.create({ pollId, optionId, userId });
    return { success: true };
}

/**
 * Close a poll (owner only)
 */
async function closePoll(pollId) {
    const poll = await Poll.findByPk(pollId);
    if (!poll) return null;
    await poll.update({ status: 'closed' });
    return poll;
}

// ========== PROJECT IDEAS & MEMBER PROJECTS ==========

async function getProjectIdeasByClubId(clubId) {
    return await ProjectIdea.findAll({
        where: { clubId },
        order: [['createdAt', 'DESC']]
    });
}

async function createProjectIdea(clubId, { title, description }) {
    return await ProjectIdea.create({
        clubId,
        title: title || '',
        description: description || null
    });
}

async function updateProjectIdea(id, updates, clubId) {
    const idea = await ProjectIdea.findByPk(id);
    if (!idea || idea.clubId !== clubId) return null;
    const inUse = await MemberProject.count({ where: { projectIdeaId: id } });
    if (inUse > 0 && updates.title !== undefined) delete updates.title;
    await idea.update(updates);
    return idea;
}

async function deleteProjectIdea(id, clubId) {
    const idea = await ProjectIdea.findByPk(id);
    if (!idea || idea.clubId !== clubId) return false;
    const inUse = await MemberProject.count({ where: { projectIdeaId: id } });
    if (inUse > 0) return false;
    await idea.destroy();
    return true;
}

async function getMemberProject(userId, clubId) {
    const mp = await MemberProject.findOne({
        where: { userId, clubId, isArchived: false }
    });
    return mp ? mp.toJSON() : null;
}

async function getClubProjectsWithMembers(clubId) {
    const members = await getClubMembers(clubId);
    const projects = await MemberProject.findAll({
        where: { clubId, isArchived: false }
    });
    const historyCounts = await MemberProjectHistory.findAll({
        attributes: ['memberProjectId', [sequelize.fn('COUNT', sequelize.col('id')), 'changeCount']],
        group: ['memberProjectId']
    });
    const countMap = {};
    historyCounts.forEach(h => { countMap[h.memberProjectId] = parseInt(h.get('changeCount'), 10) || 0; });
    const projectByUser = {};
    projects.forEach(p => { projectByUser[p.userId] = p.toJSON(); });
    return members.map(m => {
        const mp = projectByUser[m.id] || null;
        return {
            ...m,
            memberProject: mp ? {
                id: mp.id,
                projectTitle: mp.projectTitleSnapshot,
                projectDescription: mp.projectDescriptionSnapshot,
                status: mp.status,
                progressPercent: mp.progressPercent,
                approvalStatus: mp.approvalStatus,
                startedAt: mp.startedAt,
                completedAt: mp.completedAt,
                lastUpdatedAt: mp.lastUpdatedAt,
                changeCount: countMap[mp.id] || 0
            } : null
        };
    });
}

async function getClubProjectProgressSummary(clubId) {
    const totalMembers = await Membership.count({ where: { clubId } });
    const projects = await MemberProject.findAll({
        where: { clubId, isArchived: false },
        attributes: ['status', 'approvalStatus', 'progressPercent', 'projectIdeaId']
    });
    let completed = 0;
    let inProgress = 0;
    let notStarted = 0;
    let sumProgress = 0;
    let countWithProject = 0;
    projects.forEach(p => {
        if (p.status === 'completed' && p.approvalStatus === 'approved') completed++;
        else if (p.status === 'in_progress') inProgress++;
        else if (p.status === 'not_started') notStarted++;
        if (p.projectIdeaId != null) {
            countWithProject++;
            sumProgress += p.progressPercent || 0;
        }
    });
    const avgProgress = countWithProject > 0 ? Math.round(sumProgress / countWithProject) : 0;
    const pendingApproval = projects.filter(p => p.status === 'completed' && p.approvalStatus === 'pending').length;
    return {
        totalMembers,
        completed,
        inProgress,
        notStarted,
        avgProgress,
        pendingApproval
    };
}

async function chooseOrUpdateMemberProject(userId, clubId, projectIdeaId) {
    const membership = await getMembership(userId, clubId);
    if (!membership) throw new Error('Not a member of this club');
    const idea = await ProjectIdea.findByPk(projectIdeaId);
    if (!idea || idea.clubId !== clubId) throw new Error('Project idea not found');
    const now = new Date();
    let mp = await MemberProject.findOne({ where: { userId, clubId } });
    const isNew = !mp;
    const oldIdeaId = mp ? mp.projectIdeaId : null;
    if (mp) {
        if (mp.projectIdeaId === projectIdeaId) return mp;
        await MemberProjectHistory.create({
            memberProjectId: mp.id,
            oldProjectIdeaId: oldIdeaId,
            newProjectIdeaId: projectIdeaId,
            changedAt: now
        });
        await mp.update({
            projectIdeaId,
            projectTitleSnapshot: idea.title,
            projectDescriptionSnapshot: idea.description,
            startedAt: mp.startedAt || now,
            lastUpdatedAt: now
        });
    } else {
        mp = await MemberProject.create({
            userId,
            clubId,
            projectIdeaId,
            projectTitleSnapshot: idea.title,
            projectDescriptionSnapshot: idea.description,
            status: 'not_started',
            progressPercent: 0,
            startedAt: now,
            lastUpdatedAt: now
        });
    }
    return mp;
}

async function updateMemberProjectProgress(userId, clubId, { status, progressPercent }) {
    const membership = await getMembership(userId, clubId);
    if (!membership) throw new Error('Not a member of this club');
    const mp = await MemberProject.findOne({ where: { userId, clubId, isArchived: false } });
    if (!mp) throw new Error('No project chosen yet');
    if (progressPercent != null) {
        if (progressPercent < 0 || progressPercent > 100) throw new Error('progressPercent must be 0-100');
        if (progressPercent === 100 && status !== 'completed') throw new Error('If progressPercent is 100, status must be completed');
    }
    if (status) {
        if (!['not_started', 'in_progress', 'completed'].includes(status)) throw new Error('Invalid status');
        if (status === 'completed' && progressPercent != null && progressPercent < 100) throw new Error('Completed requires progressPercent 100');
    }
    const now = new Date();
    const updates = { lastUpdatedAt: now };
    if (status != null) updates.status = status;
    if (progressPercent != null) updates.progressPercent = progressPercent;
    if (status === 'completed') {
        updates.approvalStatus = 'pending';
        if (!mp.completedAt) updates.completedAt = now;
    }
    await mp.update(updates);
    return mp;
}

async function approveMemberProject(memberProjectId, approvalStatus, ownerClubId) {
    if (!['approved', 'rejected'].includes(approvalStatus)) throw new Error('approvalStatus must be approved or rejected');
    const mp = await MemberProject.findByPk(memberProjectId);
    if (!mp || mp.clubId !== ownerClubId) return null;
    await mp.update({
        approvalStatus,
        approvedAt: new Date()
    });
    return mp;
}

async function archiveMemberProjectsForUser(userId, clubId) {
    const updated = await MemberProject.update(
        { isArchived: true },
        { where: { userId, clubId } }
    );
    return updated[0] > 0;
}

// ========== ATTENDANCE FUNCTIONS ==========
async function markAttendance(eventId, userId) {
    return await Attendance.findOrCreate({
        where: { eventId, userId },
        defaults: { status: 'present' }
    });
}

async function checkAttendance(eventId, userId) {
    return await Attendance.findOne({ where: { eventId, userId } });
}

async function deleteUser(id) {
    const deleted = await User.destroy({
        where: { id }
    });
    return deleted > 0;
}

async function getUserAttendanceHistory(userId) {
    return await Attendance.findAll({
        where: { userId },
        include: [{ model: Event }],
        order: [['timestamp', 'DESC']]
    });
}

/**
 * Get club stats
 */
async function getClubStats(clubId) {
    const memberCount = await Membership.count({ where: { clubId } });
    const eventCount = await Event.count({ where: { clubId } });

    return {
        totalMembers: memberCount,
        totalEvents: eventCount
    };
}

// Export all functions
module.exports = {
    // User functions
    findUserByUsername,
    findUserByEmail,
    findUserById,
    findUserByStudentId,
    createUser,
    updateUser,
    deleteUser,
    getAllUsers,
    userExists,

    // Club functions
    getAllClubs,
    findClubById,
    findClubByOwnerId,
    createClub,
    updateClub,
    addOwnerToClub,

    // Membership functions
    getClubMembers,
    getUserClubs,
    addMemberToClub,
    removeMemberFromClub,
    updateMembership,
    getMembership,
    awardPoints,

    // Event functions
    getClubEvents,
    findEventById,
    createEvent,
    updateEvent,
    deleteEvent,
    rsvpToEvent,

    // Leaderboard & Stats
    getClubLeaderboard,
    getClubStats,

    // Announcements & Attendance
    getAnnouncementsForUser,
    markAttendance,
    checkAttendance,
    getUserAttendanceHistory,

    // Polls
    createPoll,
    getPollsByClubId,
    getPollById,
    getPollsForMember,
    votePoll,
    closePoll,

    // Project ideas & member projects
    getProjectIdeasByClubId,
    createProjectIdea,
    updateProjectIdea,
    deleteProjectIdea,
    getMemberProject,
    getClubProjectsWithMembers,
    getClubProjectProgressSummary,
    chooseOrUpdateMemberProject,
    updateMemberProjectProgress,
    approveMemberProject,
    archiveMemberProjectsForUser,

    // Raw models (for advanced queries)
    User,
    Club,
    ClubOwner,
    Event,
    Membership,
    Announcement,
    Attendance,
    EventRSVP,
    PointHistory,
    Notification,
    Message,
    GalleryPhoto,
    MemberCertificate,
    Poll,
    PollOption,
    PollVote,
    ProjectIdea,
    MemberProject,
    MemberProjectHistory,
    AttendanceSession,
    AttendanceRecord,
    sequelize,
    markAttendanceWithPoints
};
