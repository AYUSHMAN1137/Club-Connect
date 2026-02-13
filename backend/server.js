const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Op, DataTypes } = require('sequelize');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const multer = require('multer');
const { Server } = require('socket.io');
const http = require('http');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

// ========== SQL DATABASE SERVICE ==========
const db = require('./utils/dbService');
const { generateNonce, generateAttendanceToken, verifyAttendanceToken, generateAttendanceCode } = require('./utils/tokenUtils');

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';

db.ClubOwner.sync().catch(() => null);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: CLIENT_ORIGIN,
        methods: ["GET", "POST"]
    }
});

// ========== MULTER SETUP FOR FILE UPLOADS ==========

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// Storage configuration
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    // No file size limit
    fileFilter: function (req, file, cb) {
        const allowedTypes = /jpeg|jpg|png|gif|mp4|mov|webm|avi|mkv/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const allowedMimes = /image\/(jpeg|jpg|png|gif)|video\/(mp4|quicktime|webm|x-msvideo|x-matroska)/;
        const mimetype = allowedMimes.test(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only images and videos are allowed'));
        }
    }
});

// Certificate storage configuration
const certificatesDir = path.join(__dirname, 'uploads', 'certificates');
if (!fs.existsSync(certificatesDir)) {
    fs.mkdirSync(certificatesDir, { recursive: true });
}

const certificateStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, certificatesDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const uploadCertificate = multer({
    storage: certificateStorage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit for certificates
    fileFilter: function (req, file, cb) {
        const allowedTypes = /jpeg|jpg|png|pdf/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only PDF and images are allowed (pdf, jpg, png)'));
        }
    }
});

// ========== SQL-ONLY APP CONFIG ==========

// Middleware
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json());

// Rate limit for auth (prevents brute-force on login/register)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // 20 attempts per IP per window
    message: { success: false, message: 'Too many attempts. Try again later.' }
});

// Serve uploaded files
app.use('/uploads', express.static(uploadsDir));
app.use('/uploads/certificates', express.static(certificatesDir));

function getBaseUrl(req) {
    // Prefer explicit APP_URL in production; fallback to request host.
    return process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
}

function normalizeTools(tools) {
    if (!Array.isArray(tools)) return [];
    return tools.map(tool => ({
        name: String(tool.name || '').trim(),
        version: String(tool.version || '').trim(),
        link: String(tool.link || '').trim(),
        icon: String(tool.icon || '').trim()
    })).filter(tool => tool.name);
}

function resolveWorkshopStatus(workshop) {
    const status = workshop.status || 'upcoming';
    if (status === 'live' || status === 'ended' || status === 'paused') return status;
    const now = new Date();
    const start = workshop.startTime ? new Date(workshop.startTime) : null;
    const end = workshop.endTime ? new Date(workshop.endTime) : null;
    if (start && now < start) return 'upcoming';
    if (start && end && now >= start && now < end) return 'live';
    if (end && now >= end) return 'ended';
    if (start && !end && now >= start) return 'live';
    return 'upcoming';
}

function resolveWorkshopStatusWithSession(workshop, session) {
    if (session) {
        const normalized = String(session.status || '').toUpperCase();
        if (normalized === 'LIVE') return 'live';
        if (normalized === 'PAUSED') return 'paused';
        if (normalized === 'ENDED') return 'ended';
    }
    return resolveWorkshopStatus(workshop);
}

const workshopEventSchemas = {
    SESSION_STARTED: ['session_id', 'workshop_id'],
    SESSION_ENDED: ['session_id', 'workshop_id'],
    CODE_UPDATED: ['session_id', 'bundle_id', 'raw_code', 'language', 'is_published'],
    SECTIONS_PUBLISHED: ['session_id', 'visible_section_ids'],
    PREVIEW_TOGGLED: ['session_id', 'enabled'],
    PARTICIPANT_COUNT_UPDATED: ['session_id', 'count']
};

function emitWorkshopEvent(sessionId, eventType, payload) {
    const required = workshopEventSchemas[eventType] || [];
    const missing = required.filter(key => payload[key] === undefined || payload[key] === null);
    if (missing.length) {
        console.error('Invalid workshop event payload', eventType, missing);
        return;
    }
    io.to(`workshop-session-${sessionId}`).emit(eventType, payload);
}

function sliceCodeByLines(rawCode, startLine, endLine) {
    if (!rawCode) return '';
    const lines = rawCode.split(/\r?\n/);
    const start = Math.max(1, parseInt(startLine));
    const end = Math.max(start, parseInt(endLine));
    return lines.slice(start - 1, end).join('\n');
}

async function createSqlNotification(userId, { title, message, type = 'system' }) {
    const notification = await db.Notification.create({
        userId,
        title,
        message,
        type,
        isRead: false,
        createdAt: new Date()
    });

    io.to(`user-${userId}`).emit('new-notification', notification);
    return notification;
}

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

async function ensureAdminUser() {
    try {
        const existing = await db.findUserByUsername('admin');
        const desiredPassword = '1137';
        if (!existing) {
            const hashed = await bcrypt.hash(desiredPassword, 10);
            await db.createUser({
                studentId: 'ADMIN-1137',
                username: 'admin',
                email: 'admin@clubconnect.local',
                password: hashed,
                role: 'admin'
            });
            console.log('✅ Admin user created');
            return;
        }
        let shouldSave = false;
        if (existing.role !== 'admin') {
            existing.role = 'admin';
            shouldSave = true;
        }
        const passwordMatches = await bcrypt.compare(desiredPassword, existing.password);
        if (!passwordMatches) {
            existing.password = await bcrypt.hash(desiredPassword, 10);
            shouldSave = true;
        }
        if (!existing.studentId) {
            existing.studentId = 'ADMIN-1137';
            shouldSave = true;
        }
        if (shouldSave) {
            await existing.save();
            console.log('✅ Admin user updated');
        }
    } catch (error) {
        console.error('❌ Failed to ensure admin user:', error);
    }
}

// ========== MIDDLEWARE ==========

// Verify JWT token
function verifyToken(req, res, next) {
    try {
        const token = req.headers.authorization?.split(' ')[1];

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'No token provided! Please login.'
            });
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded; // Add user info to request
        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: 'Invalid or expired token!'
        });
    }
}

// Check if user is owner
function isOwner(req, res, next) {
    if (req.user.role !== 'owner') {
        return res.status(403).json({
            success: false,
            message: 'Access denied! Owner only.'
        });
    }
    next();
}

// Check if user is member
function isMember(req, res, next) {
    if (req.user.role !== 'member') {
        return res.status(403).json({
            success: false,
            message: 'Access denied! Members only.'
        });
    }
    next();
}

async function isAdmin(req, res, next) {
    try {
        const user = await db.findUserById(req.user.id);
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Access denied!' });
        }
        next();
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Server error!' });
    }
}

// ========== ROUTES ==========

// Test route
app.get('/', (req, res) => {
    res.json({ message: 'Server is running! 🚀' });
});

app.get('/health', async (req, res) => {
    try {
        await db.sequelize.authenticate();
        const rawUrl = process.env.DATABASE_URL || '';
        const dbMode = rawUrl
            ? (/localhost|127\.0\.0\.1/i.test(rawUrl) ? 'env_local_url' : 'env_remote_url')
            : 'default_local';
        let host = null;
        try {
            host = rawUrl ? new URL(rawUrl).hostname : null;
        } catch {
            host = null;
        }
        res.json({ ok: true, db: { connected: true, mode: dbMode, host } });
    } catch (error) {
        res.status(500).json({ ok: false, db: { connected: false }, error: 'db_auth_failed' });
    }
});

// REGISTER Route (only for members) - NOW USING SQL DATABASE
app.post('/auth/register', authLimiter, async (req, res) => {
    try {
        const { username, studentId, email, password } = req.body;

        // Validation
        if (!username || !studentId || !email || !password) {
            return res.status(400).json({
                success: false,
                message: 'All fields are required!'
            });
        }

        // Password validation
        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 6 characters!'
            });
        }

        // Check if user already exists using SQL
        const exists = await db.userExists(email, username, studentId);
        if (exists) {
            return res.status(400).json({
                success: false,
                message: 'Username, Student ID, or Email already exists!'
            });
        }

        // Hash password before storing
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create new user in SQL database
        const newUser = await db.createUser({
            studentId,
            username,
            email,
            password: hashedPassword,
            role: 'member'
        });

        // Generate JWT token
        const token = jwt.sign(
            { id: newUser.id, username: newUser.username, role: newUser.role },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        console.log(`✅ [SQL] New member registered: ${username}`);

        res.status(201).json({
            success: true,
            message: 'Registration successful!',
            token,
            user: {
                id: newUser.id,
                username: newUser.username,
                studentId: newUser.studentId,
                email: newUser.email,
                role: newUser.role
            }
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error! Please try again.'
        });
    }
});

// LOGIN Route - NOW USING SQL DATABASE
app.post('/auth/login', authLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        const identifier = typeof username === 'string' ? username.trim() : '';

        // Validation
        if (!identifier || !password) {
            return res.status(400).json({
                success: false,
                message: 'Username and password are required!'
            });
        }

        let user = await db.findUserByUsername(identifier);
        if (!user && identifier.includes('@')) {
            user = await db.findUserByEmail(identifier);
        }
        if (!user) {
            user = await db.findUserByStudentId(identifier);
        }

        if (!user) {
            console.log(`❌ Login failed: User "${identifier}" not found`);
            return res.status(401).json({
                success: false,
                message: 'Invalid username or password!'
            });
        }

        // Check if password field exists
        if (!user.password) {
            console.log(`❌ Login failed: User "${identifier}" has no password set`);
            return res.status(401).json({
                success: false,
                message: 'Invalid username or password!'
            });
        }

        // Support both legacy plain-text and bcrypt-hashed passwords
        let passwordValid = false;

        // If password looks like a bcrypt hash, verify with bcrypt
        if (typeof user.password === 'string' && user.password.startsWith('$2')) {
            passwordValid = await bcrypt.compare(password, user.password);
        } else {
            // Legacy plain-text password
            passwordValid = (user.password === password);

            // On successful legacy login, transparently upgrade to bcrypt hash
            if (passwordValid) {
                try {
                    const newHash = await bcrypt.hash(password, 10);
                    await db.updateUser(user.id, { password: newHash });
                    console.log(`🔐 [SQL] Upgraded password for user "${user.username}" to hashed storage`);
                } catch (upgradeErr) {
                    console.error('Error upgrading legacy password hash:', upgradeErr);
                }
            }
        }

        if (!passwordValid) {
            console.log(`❌ Login failed: Password mismatch for user "${user.username}"`);
            return res.status(401).json({
                success: false,
                message: 'Invalid username or password!'
            });
        }

        // For owners, find their club
        let clubId = null;
        if (user.role === 'owner') {
            const ownerClub = await db.findClubByOwnerId(user.id);
            if (ownerClub) {
                clubId = ownerClub.id;
            }
        }

        // Generate JWT token (include clubId for owners)
        const tokenPayload = {
            id: user.id,
            username: user.username,
            role: user.role
        };
        if (clubId) {
            tokenPayload.clubId = clubId;
        }
        const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '7d' });

        console.log(`✅ [SQL] Login successful: ${user.username} (${user.role})`);

        res.json({
            success: true,
            message: 'Login successful!',
            token,
            user: {
                id: user.id,
                username: user.username,
                studentId: user.studentId,
                email: user.email,
                role: user.role
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error! Please try again.',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Get current user (protected route) - NOW USING SQL DATABASE
app.get('/auth/me', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'No token provided!'
            });
        }

        const decoded = jwt.verify(token, JWT_SECRET);

        // Find user in SQL database
        let user = await db.findUserById(decoded.id);
        if (!user) {
            user = await db.findUserByUsername(decoded.username);
        }

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found!'
            });
        }

        // Convert to plain object and remove password
        const userObj = user.toJSON ? user.toJSON() : { ...user };
        delete userObj.password;

        res.json({
            success: true,
            user: userObj
        });

    } catch (error) {
        res.status(401).json({
            success: false,
            message: 'Invalid token!'
        });
    }
});

// ========== ADMIN API ROUTES ==========

async function deleteClubWithRelations(clubId, transaction) {
    const t = transaction;
    const events = await db.Event.findAll({ where: { clubId }, attributes: ['id'], transaction: t });
    const eventIds = events.map(e => e.id);
    if (eventIds.length > 0) {
        await db.AttendanceRecord.destroy({ where: { eventId: { [Op.in]: eventIds } }, transaction: t });
        await db.AttendanceSession.destroy({ where: { eventId: { [Op.in]: eventIds } }, transaction: t });
        await db.Attendance.destroy({ where: { eventId: { [Op.in]: eventIds } }, transaction: t });
        await db.EventRSVP.destroy({ where: { eventId: { [Op.in]: eventIds } }, transaction: t });
        await db.GalleryPhoto.destroy({ where: { eventId: { [Op.in]: eventIds } }, transaction: t });
        await db.MemberCertificate.destroy({ where: { eventId: { [Op.in]: eventIds } }, transaction: t });
    }

    const polls = await db.Poll.findAll({ where: { clubId }, attributes: ['id'], transaction: t });
    const pollIds = polls.map(p => p.id);
    if (pollIds.length > 0) {
        await db.PollVote.destroy({ where: { pollId: { [Op.in]: pollIds } }, transaction: t });
        await db.PollOption.destroy({ where: { pollId: { [Op.in]: pollIds } }, transaction: t });
        await db.Poll.destroy({ where: { id: { [Op.in]: pollIds } }, transaction: t });
    }

    const memberProjects = await db.MemberProject.findAll({ where: { clubId }, attributes: ['id'], transaction: t });
    const memberProjectIds = memberProjects.map(mp => mp.id);
    if (memberProjectIds.length > 0) {
        await db.MemberProjectHistory.destroy({ where: { memberProjectId: { [Op.in]: memberProjectIds } }, transaction: t });
    }
    await db.MemberProject.destroy({ where: { clubId }, transaction: t });
    await db.ProjectIdea.destroy({ where: { clubId }, transaction: t });

    const workshops = await db.Workshop.findAll({ where: { clubId }, attributes: ['id'], transaction: t });
    const workshopIds = workshops.map(w => w.id);
    if (workshopIds.length > 0) {
        const sessions = await db.WorkshopSession.findAll({ where: { workshopId: { [Op.in]: workshopIds } }, attributes: ['id'], transaction: t });
        const sessionIds = sessions.map(s => s.id);
        if (sessionIds.length > 0) {
            await db.CodeSection.destroy({ where: { sessionId: { [Op.in]: sessionIds } }, transaction: t });
            await db.RealtimeEventLog.destroy({ where: { sessionId: { [Op.in]: sessionIds } }, transaction: t });
            await db.CodeBundle.destroy({ where: { sessionId: { [Op.in]: sessionIds } }, transaction: t });
            await db.WorkshopSession.destroy({ where: { id: { [Op.in]: sessionIds } }, transaction: t });
        }
        await db.Workshop.destroy({ where: { id: { [Op.in]: workshopIds } }, transaction: t });
    }

    await db.Membership.destroy({ where: { clubId }, transaction: t });
    await db.PointHistory.destroy({ where: { clubId }, transaction: t });
    await db.Announcement.destroy({ where: { clubId }, transaction: t });
    await db.MemberCertificate.destroy({ where: { clubId }, transaction: t });
    await db.ClubOwner.destroy({ where: { clubId }, transaction: t });
    await db.Event.destroy({ where: { clubId }, transaction: t });
    await db.Club.destroy({ where: { id: clubId }, transaction: t });
}

async function deleteMemberWithRelations(userId, transaction) {
    const t = transaction;
    const memberProjects = await db.MemberProject.findAll({ where: { userId }, attributes: ['id'], transaction: t });
    const memberProjectIds = memberProjects.map(mp => mp.id);
    if (memberProjectIds.length > 0) {
        await db.MemberProjectHistory.destroy({ where: { memberProjectId: { [Op.in]: memberProjectIds } }, transaction: t });
    }
    await db.MemberProject.destroy({ where: { userId }, transaction: t });
    await db.Membership.destroy({ where: { userId }, transaction: t });
    await db.Attendance.destroy({ where: { userId }, transaction: t });
    await db.EventRSVP.destroy({ where: { userId }, transaction: t });
    await db.PointHistory.destroy({ where: { userId }, transaction: t });
    await db.Notification.destroy({ where: { userId }, transaction: t });
    await db.MemberCertificate.destroy({ where: { memberId: userId }, transaction: t });
    await db.PollVote.destroy({ where: { userId }, transaction: t });
    await db.AttendanceRecord.destroy({ where: { memberId: userId }, transaction: t });
    await db.Message.destroy({
        where: {
            [Op.or]: [
                { senderId: userId },
                { recipientId: userId }
            ]
        },
        transaction: t
    });
    await db.ClubOwner.destroy({ where: { userId }, transaction: t });
    await db.CodeBundle.destroy({ where: { authorId: userId }, transaction: t });
    await db.RealtimeEventLog.destroy({ where: { actorId: userId }, transaction: t });
    await db.User.destroy({ where: { id: userId }, transaction: t });
}

function safeUnlink(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (error) {
        console.error('Error deleting file:', error);
    }
}

async function deleteEventWithRelations(eventId, transaction) {
    const t = transaction;
    const photos = await db.GalleryPhoto.findAll({ where: { eventId }, transaction: t });
    const certificates = await db.MemberCertificate.findAll({ where: { eventId }, transaction: t });
    photos.forEach(photo => {
        if (photo.filename) {
            safeUnlink(path.join(uploadsDir, photo.filename));
        }
    });
    certificates.forEach(cert => {
        if (cert.filename) {
            safeUnlink(path.join(certificatesDir, cert.filename));
        }
    });
    await db.AttendanceRecord.destroy({ where: { eventId }, transaction: t });
    await db.AttendanceSession.destroy({ where: { eventId }, transaction: t });
    await db.Attendance.destroy({ where: { eventId }, transaction: t });
    await db.EventRSVP.destroy({ where: { eventId }, transaction: t });
    await db.GalleryPhoto.destroy({ where: { eventId }, transaction: t });
    await db.MemberCertificate.destroy({ where: { eventId }, transaction: t });
    await db.Event.destroy({ where: { id: eventId }, transaction: t });
}

async function deletePollWithRelations(pollId, transaction) {
    const t = transaction;
    await db.PollVote.destroy({ where: { pollId }, transaction: t });
    await db.PollOption.destroy({ where: { pollId }, transaction: t });
    await db.Poll.destroy({ where: { id: pollId }, transaction: t });
}

async function deleteWorkshopWithRelations(workshopId, transaction) {
    const t = transaction;
    const sessions = await db.WorkshopSession.findAll({ where: { workshopId }, attributes: ['id'], transaction: t });
    const sessionIds = sessions.map(s => s.id);
    if (sessionIds.length > 0) {
        await db.CodeSection.destroy({ where: { sessionId: { [Op.in]: sessionIds } }, transaction: t });
        await db.RealtimeEventLog.destroy({ where: { sessionId: { [Op.in]: sessionIds } }, transaction: t });
        await db.CodeBundle.destroy({ where: { sessionId: { [Op.in]: sessionIds } }, transaction: t });
        await db.WorkshopSession.destroy({ where: { id: { [Op.in]: sessionIds } }, transaction: t });
    }
    await db.Workshop.destroy({ where: { id: workshopId }, transaction: t });
}

// Create owner
app.post('/admin/create-owner', verifyToken, isAdmin, async (req, res) => {
    try {
        const { username, studentId, email, password } = req.body;
        if (!username || !studentId || !email || !password) {
            return res.status(400).json({ success: false, message: 'All fields are required!' });
        }
        const exists = await db.userExists(email, username, studentId);
        if (exists) {
            return res.status(400).json({ success: false, message: 'Username, Student ID, or Email already exists!' });
        }
        const hashed = await bcrypt.hash(password, 10);
        const owner = await db.createUser({ username, studentId, email, password: hashed, role: 'owner' });
        return res.status(201).json({ success: true, owner: { id: owner.id, username: owner.username, email: owner.email } });
    } catch (error) {
        console.error('Create owner error:', error);
        return res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// Create member
app.post('/admin/create-member', verifyToken, isAdmin, async (req, res) => {
    try {
        const { username, studentId, email, password } = req.body;
        if (!username || !studentId || !email || !password) {
            return res.status(400).json({ success: false, message: 'All fields are required!' });
        }
        const exists = await db.userExists(email, username, studentId);
        if (exists) {
            return res.status(400).json({ success: false, message: 'Username, Student ID, or Email already exists!' });
        }
        const hashed = await bcrypt.hash(password, 10);
        const member = await db.createUser({ username, studentId, email, password: hashed, role: 'member' });
        return res.status(201).json({ success: true, member: { id: member.id, username: member.username, email: member.email } });
    } catch (error) {
        console.error('Create member error:', error);
        return res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// Create club
app.post('/admin/create-club', verifyToken, isAdmin, async (req, res) => {
    try {
        const { name, tagline, themeColor, ownerId } = req.body;
        if (!name || !ownerId) {
            return res.status(400).json({ success: false, message: 'Club name and ownerId are required!' });
        }
        const owner = await db.findUserById(parseInt(ownerId, 10));
        if (!owner || owner.role !== 'owner') {
            return res.status(400).json({ success: false, message: 'Owner not found or invalid role!' });
        }
        const existingClub = await db.Club.findOne({ where: { name } });
        if (existingClub) {
            return res.status(400).json({ success: false, message: 'Club name already exists!' });
        }
        const club = await db.createClub({ name, tagline, themeColor, ownerId: owner.id });
        return res.status(201).json({ success: true, club });
    } catch (error) {
        console.error('Create club error:', error);
        return res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// Add member to club (by studentId)
app.post('/admin/add-member-to-club', verifyToken, isAdmin, async (req, res) => {
    try {
        const { studentId, clubId } = req.body;
        if (!studentId || !clubId) {
            return res.status(400).json({ success: false, message: 'studentId and clubId required!' });
        }
        const user = await db.findUserByStudentId(studentId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'Student not found! They must register first.' });
        }
        const { created } = await db.addMemberToClub(user.id, parseInt(clubId, 10));
        if (!created) {
            return res.json({ success: false, message: 'User is already a member of this club!' });
        }
        return res.json({ success: true, message: 'Member added to club!', memberId: user.id });
    } catch (error) {
        console.error('Add member to club error:', error);
        return res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.post('/admin/add-owner-to-club', verifyToken, isAdmin, async (req, res) => {
    try {
        const { ownerId, clubId } = req.body;
        if (!ownerId || !clubId) {
            return res.status(400).json({ success: false, message: 'ownerId and clubId required!' });
        }
        const owner = await db.findUserById(parseInt(ownerId, 10));
        if (!owner || owner.role !== 'owner') {
            return res.status(400).json({ success: false, message: 'Owner not found or invalid role!' });
        }
        const club = await db.findClubById(parseInt(clubId, 10));
        if (!club) {
            return res.status(404).json({ success: false, message: 'Club not found!' });
        }
        const { created } = await db.addOwnerToClub(owner.id, club.id);
        if (!created) {
            return res.json({ success: false, message: 'Owner already assigned to this club!' });
        }
        return res.json({ success: true, message: 'Owner added to club!' });
    } catch (error) {
        console.error('Add owner to club error:', error);
        return res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// List owners
app.get('/admin/owners', verifyToken, isAdmin, async (req, res) => {
    try {
        const users = await db.User.findAll({ where: { role: 'owner' } });
        const owners = users.map(u => ({ id: u.id, username: u.username, email: u.email }));
        return res.json({ success: true, owners });
    } catch (error) {
        console.error('List owners error:', error);
        return res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// List members
app.get('/admin/members', verifyToken, isAdmin, async (req, res) => {
    try {
        const users = await db.User.findAll({ where: { role: 'member' } });
        const members = users.map(u => ({ id: u.id, username: u.username, email: u.email }));
        return res.json({ success: true, members });
    } catch (error) {
        console.error('List members error:', error);
        return res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// List clubs
app.get('/admin/clubs', verifyToken, isAdmin, async (req, res) => {
    try {
        const clubs = await db.getAllClubs();
        const simplified = clubs.map(c => ({
            id: c.id,
            name: c.name,
            owner: c.Owner ? { id: c.Owner.id, username: c.Owner.username } : null,
            owners: Array.from(new Map(
                [
                    ...(c.Owner ? [c.Owner] : []),
                    ...(c.Owners || [])
                ].map(o => [o.id, o])
            ).values()).map(o => ({ id: o.id, username: o.username, email: o.email }))
        }));
        return res.json({ success: true, clubs: simplified });
    } catch (error) {
        console.error('List clubs error:', error);
        return res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.delete('/admin/owners/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const ownerId = parseInt(req.params.id, 10);
        if (!ownerId) {
            return res.status(400).json({ success: false, message: 'Owner ID required!' });
        }
        const owner = await db.findUserById(ownerId);
        if (!owner || owner.role !== 'owner') {
            return res.status(404).json({ success: false, message: 'Owner not found!' });
        }
        const t = await db.sequelize.transaction();
        try {
            const clubs = await db.Club.findAll({ where: { ownerId }, attributes: ['id'], transaction: t });
            for (const club of clubs) {
                await deleteClubWithRelations(club.id, t);
            }
            await db.ClubOwner.destroy({ where: { userId: ownerId }, transaction: t });
            await db.User.destroy({ where: { id: ownerId }, transaction: t });
            await t.commit();
            return res.json({ success: true, message: 'Owner deleted' });
        } catch (error) {
            await t.rollback();
            throw error;
        }
    } catch (error) {
        console.error('Delete owner error:', error);
        return res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.delete('/admin/clubs/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const clubId = parseInt(req.params.id, 10);
        if (!clubId) {
            return res.status(400).json({ success: false, message: 'Club ID required!' });
        }
        const club = await db.findClubById(clubId);
        if (!club) {
            return res.status(404).json({ success: false, message: 'Club not found!' });
        }
        const t = await db.sequelize.transaction();
        try {
            await deleteClubWithRelations(clubId, t);
            await t.commit();
            return res.json({ success: true, message: 'Club deleted' });
        } catch (error) {
            await t.rollback();
            throw error;
        }
    } catch (error) {
        console.error('Delete club error:', error);
        return res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.delete('/admin/members/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const memberId = parseInt(req.params.id, 10);
        if (!memberId) {
            return res.status(400).json({ success: false, message: 'Member ID required!' });
        }
        const member = await db.findUserById(memberId);
        if (!member || member.role !== 'member') {
            return res.status(404).json({ success: false, message: 'Member not found!' });
        }
        const t = await db.sequelize.transaction();
        try {
            await deleteMemberWithRelations(memberId, t);
            await t.commit();
            return res.json({ success: true, message: 'Member deleted' });
        } catch (error) {
            await t.rollback();
            throw error;
        }
    } catch (error) {
        console.error('Delete member error:', error);
        return res.status(500).json({ success: false, message: 'Server error!' });
    }
});
// ========== OWNER API ROUTES ==========

// Get dashboard stats - NOW USING SQL DATABASE
app.get('/owner/dashboard-stats', verifyToken, isOwner, async (req, res) => {
    try {
        // Find owner's club using SQL
        const ownerClub = await db.findClubByOwnerId(req.user.id);

        if (!ownerClub) {
            return res.status(404).json({
                success: false,
                message: 'Club not found! Please contact admin to assign you a club.'
            });
        }

        // Get club stats using SQL
        const stats = await db.getClubStats(ownerClub.id);

        // Get club events using SQL
        const events = await db.getClubEvents(ownerClub.id);

        // Get upcoming event
        const today = new Date().toISOString().split('T')[0];
        const upcomingEvents = events
            .filter(e => e.date >= today)
            .sort((a, b) => a.date.localeCompare(b.date));

        console.log(`📊 [SQL] Dashboard stats fetched for club: ${ownerClub.name}`);

        res.json({
            success: true,
            stats: {
                totalMembers: stats.totalMembers,
                totalEvents: stats.totalEvents,
                upcomingEvent: upcomingEvents[0] || null,
                clubName: ownerClub.name,
                clubLogo: ownerClub.logo,
                clubTagline: ownerClub.tagline,
                themeColor: ownerClub.themeColor,
                clubId: ownerClub.id
            }
        });
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        res.status(500).json({
            success: false,
            message: 'Server error!'
        });
    }
});

// Get all club members - NOW USING SQL DATABASE
app.get('/owner/members', verifyToken, isOwner, async (req, res) => {
    try {
        // Find owner's club using SQL
        const ownerClub = await db.findClubByOwnerId(req.user.id);

        if (!ownerClub) {
            return res.status(404).json({ success: false, message: 'Club not found! Please contact admin to assign you a club.' });
        }

        // Get club members using SQL
        const clubMembers = await db.getClubMembers(ownerClub.id);

        console.log(`👥 [SQL] Fetched ${clubMembers.length} members for club: ${ownerClub.name}`);

        res.json({ success: true, members: clubMembers });
    } catch (error) {
        console.error('Error fetching members:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// Award points to member - NOW USING SQL DATABASE
app.post('/owner/award-points', verifyToken, isOwner, async (req, res) => {
    try {
        const { memberId, points, reason } = req.body;

        if (!memberId || !points) {
            return res.status(400).json({ success: false, message: 'Member ID and points required!' });
        }

        // Find owner's club using SQL
        const ownerClub = await db.findClubByOwnerId(req.user.id);
        if (!ownerClub) {
            return res.status(404).json({ success: false, message: 'Club not found!' });
        }

        // Find member using SQL
        const member = await db.findUserById(memberId);
        if (!member) {
            return res.status(404).json({ success: false, message: 'Member not found!' });
        }

        // Award points using SQL
        const result = await db.awardPoints(memberId, ownerClub.id, parseInt(points), reason || 'Bonus', req.user.username);

        if (!result.success) {
            return res.status(400).json({ success: false, message: result.error || 'Failed to award points' });
        }

        console.log(`🏆 [SQL] Awarded ${points} points to ${member.username} in ${ownerClub.name}`);

        res.json({
            success: true,
            message: `Awarded ${points} points to ${member.username} in ${ownerClub.name}!`,
            newPoints: result.newPoints,
            newRank: result.newRank,
            clubName: ownerClub.name
        });
    } catch (error) {
        console.error('Error awarding points:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// Remove member from club - NOW USING SQL DATABASE
app.post('/owner/remove-member', verifyToken, isOwner, async (req, res) => {
    try {
        const { memberId } = req.body;

        if (!memberId) {
            return res.status(400).json({ success: false, message: 'Member ID required!' });
        }

        // Find the owner's club using SQL
        const ownerClub = await db.findClubByOwnerId(req.user.id);
        if (!ownerClub) {
            return res.status(404).json({ success: false, message: 'Club not found!' });
        }

        // Find the member using SQL
        const member = await db.findUserById(memberId);
        if (!member) {
            return res.status(404).json({ success: false, message: 'Member not found!' });
        }

        // Remove member from club using SQL
        const removed = await db.removeMemberFromClub(memberId, ownerClub.id);
        if (!removed) {
            return res.status(400).json({ success: false, message: 'Member is not part of this club!' });
        }

        console.log(`🚫 [SQL] Removed ${member.username} from ${ownerClub.name}`);

        return res.json({ success: true, message: 'Member removed from club successfully!' });
    } catch (error) {
        console.error('Error removing member:', error);
        return res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// Get all events - NOW USING SQL DATABASE
app.get('/owner/events', verifyToken, isAdminOrModerator, async (req, res) => {
    try {
        // Find user and their club
        const user = await db.findUserById(req.user.id);
        let ownerClub;

        if (user && user.role === 'owner') {
            ownerClub = await db.findClubByOwnerId(req.user.id);
        } else {
            // For admin/moderator, find club they belong to
            const userClubs = await db.getUserClubs(req.user.id);
            if (userClubs.length > 0) {
                ownerClub = await db.findClubById(userClubs[0].id);
            }
        }

        if (!ownerClub) {
            return res.status(404).json({ success: false, message: 'Club not found!' });
        }

        // Get club events using SQL
        const clubEvents = await db.getClubEvents(ownerClub.id);

        console.log(`📅 [SQL] Fetched ${clubEvents.length} events for club: ${ownerClub.name}`);

        res.json({ success: true, events: clubEvents });
    } catch (error) {
        console.error('Error fetching events:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// Create new event - NOW USING SQL DATABASE
app.post('/owner/create-event', verifyToken, isOwner, async (req, res) => {
    try {
        const { title, date, venue, description } = req.body;

        if (!title || !date || !venue) {
            return res.status(400).json({ success: false, message: 'Title, date, and venue required!' });
        }

        // Find owner's club using SQL
        const ownerClub = await db.findClubByOwnerId(req.user.id);
        if (!ownerClub) {
            return res.status(404).json({ success: false, message: 'Club not found!' });
        }

        const normalizedTitle = String(title).trim();
        const normalizedVenue = String(venue).trim();
        const normalizedDescription = description != null ? String(description).trim() : '';
        const cutoff = new Date(Date.now() - 15000);
        const existingEvent = await db.Event.findOne({
            where: {
                clubId: ownerClub.id,
                title: normalizedTitle,
                date,
                venue: normalizedVenue,
                createdAt: { [Op.gte]: cutoff }
            },
            order: [['createdAt', 'DESC']]
        });

        if (existingEvent) {
            return res.json({
                success: true,
                message: 'Event already created!',
                event: existingEvent,
                duplicate: true
            });
        }

        // Generate QR code
        const qrData = JSON.stringify({ clubId: ownerClub.id, title: normalizedTitle, date });
        const qrCode = await QRCode.toDataURL(qrData);

        // Create event using SQL
        const newEvent = await db.createEvent({
            title: normalizedTitle,
            date,
            venue: normalizedVenue,
            description: normalizedDescription,
            qrCode,
            clubId: ownerClub.id
        });

        console.log(`📅 [SQL] Created event: ${title} for club: ${ownerClub.name}`);

        res.json({
            success: true,
            message: 'Event created successfully!',
            event: newEvent
        });
    } catch (error) {
        console.error('Error creating event:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// Get single event details
app.get('/owner/event/:id', verifyToken, isAdminOrModerator, async (req, res) => {
    try {
        const user = await db.findUserById(req.user.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found!' });
        }

        // Determine club context (owner => owned club; otherwise first membership)
        let club;
        if (user.role === 'owner') {
            club = await db.findClubByOwnerId(user.id);
        } else {
            const memberships = await db.getUserClubs(user.id);
            if (!memberships || memberships.length === 0) {
                return res.status(403).json({ success: false, message: 'Access denied!' });
            }
            club = await db.findClubById(memberships[0].id);
        }

        if (!club) {
            return res.status(404).json({ success: false, message: 'Club not found!' });
        }

        const eventId = parseInt(req.params.id);
        const event = await db.findEventById(eventId);
        if (!event) {
            return res.status(404).json({ success: false, message: 'Event not found!' });
        }

        if (event.clubId !== club.id) {
            return res.status(403).json({ success: false, message: 'Access denied!' });
        }

        const attendanceRows = await db.Attendance.findAll({
            where: { eventId: eventId },
            order: [['timestamp', 'ASC']]
        });
        const presentUserIds = new Set(attendanceRows.map(a => a.userId));

        const clubMembers = await db.getClubMembers(club.id);
        const clubMembersForAttendance = clubMembers.map(m => ({
            id: m.id,
            username: m.username,
            email: m.email,
            studentId: m.studentId,
            profilePic: m.profile?.pic || '',
            isPresent: presentUserIds.has(m.id)
        }));

        res.json({
            success: true,
            event: {
                ...event,
                attendanceDetails: attendanceRows,
                clubMembers: clubMembersForAttendance
            }
        });
    } catch (error) {
        console.error('Error fetching event:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.delete('/owner/events/:id', verifyToken, isOwner, async (req, res) => {
    try {
        const eventId = parseInt(req.params.id, 10);
        if (!eventId) {
            return res.status(400).json({ success: false, message: 'Event ID required!' });
        }
        const ownerClub = await db.findClubByOwnerId(req.user.id);
        if (!ownerClub) {
            return res.status(404).json({ success: false, message: 'Club not found!' });
        }
        const event = await db.findEventById(eventId);
        if (!event) {
            return res.status(404).json({ success: false, message: 'Event not found!' });
        }
        if (event.clubId !== ownerClub.id) {
            return res.status(403).json({ success: false, message: 'Access denied!' });
        }
        const t = await db.sequelize.transaction();
        try {
            await deleteEventWithRelations(eventId, t);
            await t.commit();
            res.json({ success: true, message: 'Event deleted!' });
        } catch (error) {
            await t.rollback();
            throw error;
        }
    } catch (error) {
        console.error('Error deleting event:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.get('/owner/event/:id/attendance-export', verifyToken, isAdminOrModerator, async (req, res) => {
    try {
        const user = await db.findUserById(req.user.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found!' });
        }

        let club;
        if (user.role === 'owner') {
            club = await db.findClubByOwnerId(user.id);
        } else {
            const memberships = await db.getUserClubs(user.id);
            if (!memberships || memberships.length === 0) {
                return res.status(403).json({ success: false, message: 'Access denied!' });
            }
            club = await db.findClubById(memberships[0].id);
        }

        if (!club) {
            return res.status(404).json({ success: false, message: 'Club not found!' });
        }

        const eventId = parseInt(req.params.id);
        const event = await db.findEventById(eventId);
        if (!event) {
            return res.status(404).json({ success: false, message: 'Event not found!' });
        }

        if (event.clubId !== club.id) {
            return res.status(403).json({ success: false, message: 'Access denied!' });
        }

        const attendanceRecords = await db.AttendanceRecord.findAll({
            where: { eventId },
            include: [{ model: db.User, as: 'Member', attributes: ['id', 'username', 'email', 'studentId'] }],
            order: [['checkedInAt', 'ASC']]
        });

        const attendances = await db.Attendance.findAll({
            where: { eventId },
            include: [{ model: db.User, attributes: ['id', 'username', 'email', 'studentId'] }],
            order: [['timestamp', 'ASC']]
        });

        const memberMap = new Map();
        const toMillis = (value) => {
            if (!value) return 0;
            const date = new Date(value);
            return Number.isNaN(date.getTime()) ? 0 : date.getTime();
        };
        const toIso = (value) => {
            if (!value) return '';
            const date = new Date(value);
            return Number.isNaN(date.getTime()) ? '' : date.toISOString();
        };
        const toTime12h = (value) => {
            if (!value) return '';
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return '';
            return date.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                second: '2-digit',
                hour12: true
            });
        };
        const isNewer = (nextTime, currentTime) => {
            if (!currentTime) return !!nextTime;
            if (!nextTime) return false;
            return new Date(nextTime) > new Date(currentTime);
        };

        attendanceRecords.forEach((r) => {
            const member = r.Member || {};
            const checkedInAt = r.checkedInAt || null;
            if (!member.id) return;
            const existing = memberMap.get(member.id);
            if (!existing || isNewer(checkedInAt, existing.checkedInAt)) {
                memberMap.set(member.id, {
                    id: member.id,
                    username: member.username,
                    email: member.email,
                    studentId: member.studentId,
                    checkedInAt
                });
            }
        });

        attendances.forEach((a) => {
            const member = a.User || {};
            const checkedInAt = a.timestamp || null;
            if (!member.id) return;
            const existing = memberMap.get(member.id);
            if (!existing || isNewer(checkedInAt, existing.checkedInAt)) {
                memberMap.set(member.id, {
                    id: member.id,
                    username: member.username,
                    email: member.email,
                    studentId: member.studentId,
                    checkedInAt
                });
            }
        });

        const members = Array.from(memberMap.values()).sort((a, b) => toMillis(a.checkedInAt) - toMillis(b.checkedInAt));

        const escape = (value) => {
            if (value === null || value === undefined) return '';
            const text = String(value);
            if (/[",\n]/.test(text)) {
                return `"${text.replace(/"/g, '""')}"`;
            }
            return text;
        };

        const headerLines = [
            `Club: ${club.name || ''}`,
            `Event: ${event.title || ''}`,
            `Date: ${event.date || ''}`,
            `Exported At: ${toTime12h(new Date())}`,
            `Total Present: ${members.length}`
        ];
        const columns = ['Name', 'Student ID', 'Email', 'Time'];

        const dataLines = members.map(m => {
            const time = toTime12h(m.checkedInAt);
            return [m.username || '', m.studentId || '', m.email || '', time].map(escape).join(',');
        });

        const csvBody = [
            ...headerLines.map(escape),
            '',
            columns.map(escape).join(','),
            ...dataLines
        ].join('\n');

        const safeTitle = (event.title || 'event').toLowerCase().replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
        const safeDate = String(event.date || '').replace(/[^0-9\-]/g, '') || 'date';
        const filename = `attendance_${safeTitle || 'event'}_${safeDate}.csv`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send('\ufeff' + csvBody);
    } catch (error) {
        console.error('Error exporting attendance:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// Generate QR code for event
app.post('/owner/generate-qr', verifyToken, isOwner, async (req, res) => {
    try {
        const { eventId } = req.body;

        if (!eventId) {
            return res.status(400).json({ success: false, message: 'Event ID required!' });
        }

        const ownerClub = await db.findClubByOwnerId(req.user.id);
        if (!ownerClub) {
            return res.status(404).json({ success: false, message: 'Club not found!' });
        }

        const event = await db.findEventById(parseInt(eventId));
        if (!event) {
            return res.status(404).json({ success: false, message: 'Event not found!' });
        }

        if (event.clubId !== ownerClub.id) {
            return res.status(403).json({ success: false, message: 'Access denied!' });
        }

        // Regenerate QR code
        const qrData = JSON.stringify({ eventId: event.id, clubId: event.clubId, timestamp: Date.now() });
        const qrCode = await QRCode.toDataURL(qrData);

        await db.updateEvent(event.id, { qrCode });

        res.json({ success: true, qrCode });
    } catch (error) {
        console.error('Error generating QR code:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// Get announcements - PURE SQL
app.get('/owner/announcements', verifyToken, isOwner, async (req, res) => {
    try {
        const ownerClub = await db.findClubByOwnerId(req.user.id);

        if (!ownerClub) {
            return res.status(404).json({ success: false, message: 'Club not found!' });
        }

        const clubAnnouncements = await db.Announcement.findAll({
            where: { clubId: ownerClub.id },
            order: [['date', 'DESC']]
        });

        res.json({ success: true, announcements: clubAnnouncements });
    } catch (error) {
        console.error('Error fetching announcements:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.delete('/owner/announcements/:id', verifyToken, isOwner, async (req, res) => {
    try {
        const announcementId = parseInt(req.params.id, 10);
        if (!announcementId) {
            return res.status(400).json({ success: false, message: 'Announcement ID required!' });
        }
        const ownerClub = await db.findClubByOwnerId(req.user.id);
        if (!ownerClub) {
            return res.status(404).json({ success: false, message: 'Club not found!' });
        }
        const announcement = await db.Announcement.findByPk(announcementId);
        if (!announcement) {
            return res.status(404).json({ success: false, message: 'Announcement not found!' });
        }
        if (announcement.clubId !== ownerClub.id) {
            return res.status(403).json({ success: false, message: 'Access denied!' });
        }
        await announcement.destroy();
        res.json({ success: true, message: 'Announcement deleted!' });
    } catch (error) {
        console.error('Error deleting announcement:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// Send announcement
app.post('/owner/send-announcement', verifyToken, isOwner, async (req, res) => {
    try {
        const { message, title } = req.body;

        console.log(`📢 Announcement request from ${req.user.username}:`, { title, message: message?.substring(0, 50) });

        if (!message) {
            return res.status(400).json({ success: false, message: 'Message required!' });
        }

        const ownerClub = await db.findClubByOwnerId(req.user.id);

        if (!ownerClub) {
            console.error(`❌ Club not found for owner: ${req.user.username} (ID: ${req.user.id})`);
            return res.status(404).json({ success: false, message: 'Club not found!' });
        }

        console.log(`✅ Owner club found: ${ownerClub.name} (ID: ${ownerClub.id})`);

        const normalizedTitle = String(title || 'Announcement').trim();
        const normalizedMessage = String(message).trim();
        const cutoff = new Date(Date.now() - 15000);
        const existingAnnouncement = await db.Announcement.findOne({
            where: {
                clubId: ownerClub.id,
                title: normalizedTitle,
                message: normalizedMessage,
                createdAt: { [Op.gte]: cutoff }
            },
            order: [['createdAt', 'DESC']]
        });

        if (existingAnnouncement) {
            return res.json({
                success: true,
                message: 'Announcement already sent!',
                announcement: existingAnnouncement,
                duplicate: true
            });
        }

        const newAnnouncement = await db.Announcement.create({
            clubId: ownerClub.id,
            title: normalizedTitle,
            message: normalizedMessage,
            date: new Date(),
            createdById: req.user.id  // Use FK instead of username string
        });

        console.log(`💾 Announcement saved (ID: ${newAnnouncement.id})`);

        res.json({ success: true, message: 'Announcement sent!', announcement: newAnnouncement });
    } catch (error) {
        console.error('❌ Error sending announcement:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// ========== POLLS (Owner) ==========
app.get('/owner/polls', verifyToken, isOwner, async (req, res) => {
    try {
        const ownerClub = await db.findClubByOwnerId(req.user.id);
        if (!ownerClub) return res.status(404).json({ success: false, message: 'Club not found!' });
        const polls = await db.getPollsByClubId(ownerClub.id);
        const withCounts = await Promise.all(polls.map(async (p) => {
            const full = await db.getPollById(p.id, { includeVoteCounts: true });
            return full;
        }));
        res.json({ success: true, polls: withCounts });
    } catch (error) {
        console.error('Error fetching polls:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.post('/owner/polls', verifyToken, isOwner, async (req, res) => {
    try {
        const { question, options, endDate } = req.body;
        if (!question || !options || !Array.isArray(options)) {
            return res.status(400).json({ success: false, message: 'Question and options (array) required!' });
        }
        const ownerClub = await db.findClubByOwnerId(req.user.id);
        if (!ownerClub) return res.status(404).json({ success: false, message: 'Club not found!' });
        const normalizedQuestion = String(question).trim();
        const cutoff = new Date(Date.now() - 15000);
        const existingPoll = await db.Poll.findOne({
            where: {
                clubId: ownerClub.id,
                createdById: req.user.id,
                question: normalizedQuestion,
                createdAt: { [Op.gte]: cutoff }
            },
            order: [['createdAt', 'DESC']]
        });
        if (existingPoll) {
            const fullExisting = await db.getPollById(existingPoll.id, { includeVoteCounts: true });
            return res.status(200).json({ success: true, message: 'Poll already created!', poll: fullExisting, duplicate: true });
        }
        const poll = await db.createPoll(ownerClub.id, req.user.id, normalizedQuestion, options, endDate || null);
        const full = await db.getPollById(poll.id, { includeVoteCounts: true });
        res.status(201).json({ success: true, message: 'Poll created!', poll: full });
    } catch (error) {
        console.error('Error creating poll:', error);
        res.status(500).json({ success: false, message: error.message || 'Server error!' });
    }
});

app.get('/owner/polls/:id', verifyToken, isOwner, async (req, res) => {
    try {
        const poll = await db.getPollById(parseInt(req.params.id, 10), { includeVoteCounts: true });
        if (!poll) return res.status(404).json({ success: false, message: 'Poll not found!' });
        const ownerClub = await db.findClubByOwnerId(req.user.id);
        if (!ownerClub || poll.clubId !== ownerClub.id) return res.status(403).json({ success: false, message: 'Access denied!' });
        res.json({ success: true, poll });
    } catch (error) {
        console.error('Error fetching poll:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.patch('/owner/polls/:id/close', verifyToken, isOwner, async (req, res) => {
    try {
        const poll = await db.getPollById(parseInt(req.params.id, 10));
        if (!poll) return res.status(404).json({ success: false, message: 'Poll not found!' });
        const ownerClub = await db.findClubByOwnerId(req.user.id);
        if (!ownerClub || poll.clubId !== ownerClub.id) return res.status(403).json({ success: false, message: 'Access denied!' });
        await db.closePoll(poll.id);
        const updated = await db.getPollById(poll.id, { includeVoteCounts: true });
        res.json({ success: true, message: 'Poll closed!', poll: updated });
    } catch (error) {
        console.error('Error closing poll:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.delete('/owner/polls/:id', verifyToken, isOwner, async (req, res) => {
    try {
        const pollId = parseInt(req.params.id, 10);
        if (!pollId) return res.status(400).json({ success: false, message: 'Poll ID required!' });
        const poll = await db.getPollById(pollId);
        if (!poll) return res.status(404).json({ success: false, message: 'Poll not found!' });
        const ownerClub = await db.findClubByOwnerId(req.user.id);
        if (!ownerClub || poll.clubId !== ownerClub.id) return res.status(403).json({ success: false, message: 'Access denied!' });
        const t = await db.sequelize.transaction();
        try {
            await deletePollWithRelations(pollId, t);
            await t.commit();
            res.json({ success: true, message: 'Poll deleted!' });
        } catch (error) {
            await t.rollback();
            throw error;
        }
    } catch (error) {
        console.error('Error deleting poll:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.get('/owner/certificates', verifyToken, isOwner, async (req, res) => {
    try {
        const ownerClub = await db.findClubByOwnerId(req.user.id);
        if (!ownerClub) return res.status(404).json({ success: false, message: 'Club not found!' });
        const certificates = await db.MemberCertificate.findAll({
            where: { clubId: ownerClub.id },
            include: [
                { model: db.User, attributes: ['id', 'username', 'email'] },
                { model: db.Event, attributes: ['id', 'title'] }
            ],
            order: [['uploadedAt', 'DESC']]
        });
        const baseUrl = getBaseUrl(req);
        res.json({
            success: true,
            certificates: certificates.map(c => ({
                ...c.toJSON(),
                filepath: `${baseUrl}${c.filepath}`,
                member: c.User ? { id: c.User.id, username: c.User.username, email: c.User.email } : null,
                event: c.Event ? { id: c.Event.id, title: c.Event.title } : null
            }))
        });
    } catch (error) {
        console.error('Error fetching owner certificates:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.delete('/owner/certificates/:id', verifyToken, isOwner, async (req, res) => {
    try {
        const certId = parseInt(req.params.id, 10);
        if (!certId) return res.status(400).json({ success: false, message: 'Certificate ID required!' });
        const ownerClub = await db.findClubByOwnerId(req.user.id);
        if (!ownerClub) return res.status(404).json({ success: false, message: 'Club not found!' });
        const cert = await db.MemberCertificate.findByPk(certId);
        if (!cert || cert.clubId !== ownerClub.id) {
            return res.status(404).json({ success: false, message: 'Certificate not found!' });
        }
        if (cert.filename) {
            safeUnlink(path.join(certificatesDir, cert.filename));
        }
        await cert.destroy();
        res.json({ success: true, message: 'Certificate deleted successfully!' });
    } catch (error) {
        console.error('Error deleting certificate:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// ========== PROJECT IDEAS & PROJECT PROGRESS (Owner) ==========
app.get('/owner/project-ideas', verifyToken, isOwner, async (req, res) => {
    try {
        const ownerClub = await db.findClubByOwnerId(req.user.id);
        if (!ownerClub) return res.status(404).json({ success: false, message: 'Club not found!' });
        const ideas = await db.getProjectIdeasByClubId(ownerClub.id);
        res.json({ success: true, projectIdeas: ideas });
    } catch (error) {
        console.error('Error fetching project ideas:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.post('/owner/project-ideas', verifyToken, isOwner, async (req, res) => {
    try {
        const { title, description } = req.body;
        const ownerClub = await db.findClubByOwnerId(req.user.id);
        if (!ownerClub) return res.status(404).json({ success: false, message: 'Club not found!' });
        const normalizedTitle = String(title || '').trim();
        const normalizedDescription = description != null ? String(description).trim() : '';
        if (!normalizedTitle) {
            return res.status(400).json({ success: false, message: 'Project idea title required!' });
        }
        const cutoff = new Date(Date.now() - 15000);
        const existingIdea = await db.ProjectIdea.findOne({
            where: {
                clubId: ownerClub.id,
                title: normalizedTitle,
                description: normalizedDescription || null,
                createdAt: { [Op.gte]: cutoff }
            },
            order: [['createdAt', 'DESC']]
        });
        if (existingIdea) {
            return res.status(200).json({ success: true, message: 'Project idea already created!', projectIdea: existingIdea, duplicate: true });
        }
        const idea = await db.createProjectIdea(ownerClub.id, { title: normalizedTitle, description: normalizedDescription });
        res.status(201).json({ success: true, message: 'Project idea created!', projectIdea: idea });
    } catch (error) {
        console.error('Error creating project idea:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.put('/owner/project-ideas/:id', verifyToken, isOwner, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const { title, description } = req.body;
        const ownerClub = await db.findClubByOwnerId(req.user.id);
        if (!ownerClub) return res.status(404).json({ success: false, message: 'Club not found!' });
        const idea = await db.updateProjectIdea(id, { title, description }, ownerClub.id);
        if (!idea) return res.status(404).json({ success: false, message: 'Project idea not found!' });
        res.json({ success: true, message: 'Updated!', projectIdea: idea });
    } catch (error) {
        console.error('Error updating project idea:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.delete('/owner/project-ideas/:id', verifyToken, isOwner, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const ownerClub = await db.findClubByOwnerId(req.user.id);
        if (!ownerClub) return res.status(404).json({ success: false, message: 'Club not found!' });
        const deleted = await db.deleteProjectIdea(id, ownerClub.id);
        if (!deleted) return res.status(400).json({ success: false, message: 'Cannot delete: project idea is in use by members!' });
        res.json({ success: true, message: 'Deleted!' });
    } catch (error) {
        console.error('Error deleting project idea:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.get('/owner/project-progress', verifyToken, isOwner, async (req, res) => {
    try {
        const ownerClub = await db.findClubByOwnerId(req.user.id);
        if (!ownerClub) return res.status(404).json({ success: false, message: 'Club not found!' });
        const [summary, membersWithProjects] = await Promise.all([
            db.getClubProjectProgressSummary(ownerClub.id),
            db.getClubProjectsWithMembers(ownerClub.id)
        ]);
        res.json({
            success: true,
            club: { id: ownerClub.id, name: ownerClub.name, tagline: ownerClub.tagline, description: ownerClub.description },
            summary,
            members: membersWithProjects
        });
    } catch (error) {
        console.error('Error fetching project progress:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.put('/owner/approve-project', verifyToken, isOwner, async (req, res) => {
    try {
        const { memberProjectId, approvalStatus } = req.body;
        if (!memberProjectId || !approvalStatus) return res.status(400).json({ success: false, message: 'memberProjectId and approvalStatus required!' });
        const ownerClub = await db.findClubByOwnerId(req.user.id);
        if (!ownerClub) return res.status(404).json({ success: false, message: 'Club not found!' });
        const mp = await db.approveMemberProject(parseInt(memberProjectId, 10), approvalStatus, ownerClub.id);
        if (!mp) return res.status(404).json({ success: false, message: 'Member project not found!' });
        res.json({ success: true, message: approvalStatus === 'approved' ? 'Approved!' : 'Rejected.' });
    } catch (error) {
        console.error('Error approving project:', error);
        res.status(500).json({ success: false, message: error.message || 'Server error!' });
    }
});

// Get analytics - PURE SQL PRODUCTION
app.get('/owner/analytics', verifyToken, isOwner, async (req, res) => {
    try {
        const ownerClub = await db.findClubByOwnerId(req.user.id);

        if (!ownerClub) {
            return res.status(404).json({ success: false, message: 'Club not found!' });
        }

        const clubId = ownerClub.id;

        // 1. Top Members (From Membership table)
        const topMembersData = await db.getClubLeaderboard(clubId, 5);
        const topMembers = topMembersData.map(m => ({
            name: m.username,
            points: m.points
        }));

        // 2. Stats
        const stats = await db.getClubStats(clubId);

        // 3. Participation Rate Calculation
        // Need total attendance for club events
        // SQL: count Attendance joined Event where Event.clubId = clubId
        // Complicated query, let's simplify or use raw SQL if needed, but Sequelize association works.
        // Or fetch all club events and sum attendance?
        const clubEvents = await db.getClubEvents(clubId);
        let totalAttendance = 0;

        for (const event of clubEvents) {
            // Check Attendance table count
            const count = await db.Attendance.count({ where: { eventId: event.id } });
            totalAttendance += count;
        }

        const totalEventSlots = stats.totalEvents * stats.totalMembers;
        const participationRate = totalEventSlots > 0 ? ((totalAttendance / totalEventSlots) * 100).toFixed(1) : 0;
        const averageAttendance = stats.totalEvents > 0 ? (totalAttendance / stats.totalEvents).toFixed(1) : 0;

        res.json({
            success: true,
            analytics: {
                topMembers,
                participationRate,
                totalEvents: stats.totalEvents,
                totalMembers: stats.totalMembers,
                averageAttendance
            }
        });
    } catch (error) {
        console.error('Error fetching analytics:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// Update club customization
app.post('/owner/update-club', verifyToken, isOwner, async (req, res) => {
    try {
        const { name, tagline, themeColor, logo } = req.body;

        const ownerClub = await db.findClubByOwnerId(req.user.id);
        if (!ownerClub) {
            return res.status(404).json({ success: false, message: 'Club not found!' });
        }

        const updates = {};
        if (name) updates.name = name;
        if (tagline !== undefined) updates.tagline = tagline;
        if (themeColor !== undefined) updates.themeColor = themeColor;
        if (logo !== undefined) updates.logo = logo;

        const updatedClub = await db.updateClub(ownerClub.id, updates);
        res.json({ success: true, message: 'Club updated successfully!', club: updatedClub });
    } catch (error) {
        console.error('Error updating club:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// Upload event gallery photos
app.post('/owner/upload-gallery', verifyToken, isOwner, upload.array('photos'), async (req, res) => {
    try {
        const { eventId } = req.body;

        if (!eventId) {
            return res.status(400).json({ success: false, message: 'Event ID required!' });
        }

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, message: 'No files uploaded!' });
        }

        const ownerClub = await db.findClubByOwnerId(req.user.id);
        if (!ownerClub) {
            return res.status(404).json({ success: false, message: 'Club not found!' });
        }

        const event = await db.findEventById(parseInt(eventId));
        if (!event) {
            return res.status(404).json({ success: false, message: 'Event not found!' });
        }

        if (event.clubId !== ownerClub.id) {
            return res.status(403).json({ success: false, message: 'Access denied!' });
        }

        // Get existing photos for this event to check for duplicates
        const existingPhotos = await db.GalleryPhoto.findAll({
            where: { eventId: parseInt(eventId) }
        });

        // Create a Set of "originalName|fileSize" for quick lookup
        const existingKeys = new Set(
            existingPhotos
                .filter(p => p.originalName && p.fileSize)
                .map(p => `${p.originalName}|${p.fileSize}`)
        );

        // Filter out duplicates based on original filename and file size
        const newFiles = [];
        const duplicates = [];

        for (const file of req.files) {
            const key = `${file.originalname}|${file.size}`;

            if (existingKeys.has(key)) {
                duplicates.push(file.originalname);
                // Delete the uploaded duplicate file
                try {
                    fs.unlinkSync(file.path);
                } catch (e) { }
            } else {
                newFiles.push(file);
                existingKeys.add(key); // Prevent duplicates within same upload batch
            }
        }

        if (newFiles.length === 0) {
            return res.json({
                success: true,
                message: `All ${duplicates.length} file(s) were duplicates and skipped.`,
                photos: [],
                duplicates: duplicates
            });
        }

        const photosToCreate = newFiles.map(file => ({
            eventId: parseInt(eventId),
            filename: file.filename,
            originalName: file.originalname,
            fileSize: file.size,
            url: `/uploads/${file.filename}`,
            uploadedAt: new Date()
        }));

        const created = await db.GalleryPhoto.bulkCreate(photosToCreate);

        const baseUrl = getBaseUrl(req);
        const photos = created.map(p => ({
            id: p.id,
            eventId: p.eventId,
            filename: p.filename,
            originalName: p.originalName,
            url: p.url,
            fullUrl: `${baseUrl}${p.url}`,
            uploadedAt: p.uploadedAt
        }));

        let message = `${photos.length} file(s) uploaded successfully!`;
        if (duplicates.length > 0) {
            message += ` (${duplicates.length} duplicate(s) skipped)`;
        }

        res.json({
            success: true,
            message,
            photos,
            duplicates
        });
    } catch (error) {
        console.error('Error uploading gallery:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// Get event gallery
app.get('/gallery/:eventId', verifyToken, async (req, res) => {
    try {
        const eventId = parseInt(req.params.eventId);
        const photos = await db.GalleryPhoto.findAll({
            where: { eventId },
            order: [['uploadedAt', 'ASC']]
        });

        const baseUrl = getBaseUrl(req);
        const photosWithFullUrl = photos.map(p => ({
            id: p.id,
            eventId: p.eventId,
            filename: p.filename,
            url: p.url,
            fullUrl: `${baseUrl}${p.url}`,
            uploadedAt: p.uploadedAt
        }));

        res.json({ success: true, photos: photosWithFullUrl });
    } catch (error) {
        console.error('Error fetching gallery:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// Delete gallery photo
app.delete('/owner/gallery/:photoId', verifyToken, isOwner, async (req, res) => {
    try {
        const photoId = parseInt(req.params.photoId);

        const photo = await db.GalleryPhoto.findByPk(photoId);
        if (!photo) {
            return res.status(404).json({ success: false, message: 'Photo not found!' });
        }

        // Verify owner has access to this photo's event
        const event = await db.findEventById(photo.eventId);
        if (!event) {
            return res.status(404).json({ success: false, message: 'Event not found!' });
        }

        const ownerClub = await db.findClubByOwnerId(req.user.id);
        if (!ownerClub || event.clubId !== ownerClub.id) {
            return res.status(403).json({ success: false, message: 'Access denied!' });
        }

        // Delete the file from disk
        try {
            const filePath = path.join(uploadsDir, photo.filename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (e) {
            console.error('Error deleting file:', e);
        }

        // Delete from database
        await photo.destroy();

        res.json({ success: true, message: 'Photo deleted successfully!' });
    } catch (error) {
        console.error('Error deleting gallery photo:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// ========== MEMBER API ROUTES ==========

async function resolveMemberClubContext(userId) {
    const member = await db.findUserById(userId);
    if (!member) return { member: null, clubs: [], activeClubId: null, activeClub: null };
    const clubs = await db.getUserClubs(userId);
    if (!clubs || clubs.length === 0) return { member, clubs: [], activeClubId: null, activeClub: null };
    let activeClubId = member.activeClubId;
    if (!activeClubId || !clubs.some(c => c.id === activeClubId)) {
        activeClubId = clubs[0].id;
        await db.updateUser(userId, { activeClubId });
    }
    const activeClub = clubs.find(c => c.id === activeClubId) || clubs[0];
    return { member, clubs, activeClubId, activeClub };
}

async function ensureActiveClubColumn() {
    const qi = db.sequelize.getQueryInterface();
    const table = await qi.describeTable('Users');
    if (!table.activeClubId) {
        await qi.addColumn('Users', 'activeClubId', { type: DataTypes.INTEGER, allowNull: true });
    }
}

// Get member dashboard - NOW USING SQL DATABASE
app.get('/member/dashboard', verifyToken, isMember, async (req, res) => {
    try {
        const { member, clubs: memberClubs, activeClub, activeClubId } = await resolveMemberClubContext(req.user.id);
        if (!member) {
            return res.status(404).json({ success: false, message: 'Member not found!' });
        }

        // Handle case when member has no club
        if (!memberClubs || memberClubs.length === 0) {
            return res.json({
                success: true,
                dashboard: {
                    points: 0,
                    rank: 'Rookie',
                    stats: { attendanceCount: 0, totalEvents: 0 },
                    attendancePercentage: 0,
                    upcomingEvent: null,
                    clubName: '',
                    profile: {
                        pic: member.profilePic || '',
                        bio: member.bio || ''
                    },
                    hasNoClub: true,
                    status: 'unassigned'
                }
            });
        }

        const club = await db.findClubById(activeClubId || activeClub.id);

        // Get club events using SQL
        const clubEvents = await db.getClubEvents(activeClub.id);

        // Get upcoming event
        const today = new Date().toISOString().split('T')[0];
        const upcomingEvents = clubEvents
            .filter(e => e.date >= today)
            .sort((a, b) => a.date.localeCompare(b.date));

        // Calculate total points across all clubs
        let totalPoints = 0;
        memberClubs.forEach(c => totalPoints += c.points || 0);

        console.log(`📊 [SQL] Member dashboard loaded for: ${member.username}`);

        res.json({
            success: true,
            dashboard: {
                points: activeClub.points || 0,
                totalPoints: totalPoints,
                rank: activeClub.rank || 'Rookie',
                stats: { attendanceCount: 0, totalEvents: clubEvents.length },
                attendancePercentage: 0,
                upcomingEvent: upcomingEvents[0] || null,
                clubName: club?.name || '',
                clubTagline: club?.tagline || '',
                clubThemeColor: club?.themeColor || '',
                profile: {
                    pic: member.profilePic || '',
                    bio: member.bio || ''
                },
                hasNoClub: false,
                status: activeClub.status || 'active'
            }
        });
    } catch (error) {
        console.error('Error fetching member dashboard:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// Get member events - NOW USING SQL DATABASE
app.get('/member/events', verifyToken, isMember, async (req, res) => {
    try {
        const { clubs: memberClubs, activeClub } = await resolveMemberClubContext(req.user.id);

        // Handle case when member has no club
        if (!memberClubs || memberClubs.length === 0) {
            return res.json({ success: true, events: [] });
        }

        const clubEvents = await db.getClubEvents(activeClub.id);

        // Add hasRsvped and hasAttended for each event
        const eventsWithStatus = clubEvents.map(event => {
            const hasRsvped = event.rsvpList && event.rsvpList.includes(req.user.id);
            const hasAttended = event.attendanceList && event.attendanceList.includes(req.user.id);
            return {
                ...event,
                hasRsvped,
                hasAttended
            };
        });

        console.log(`📅 [SQL] Member events fetched: ${eventsWithStatus.length} events`);

        res.json({ success: true, events: eventsWithStatus });
    } catch (error) {
        console.error('Error fetching events:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// RSVP for event
// RSVP for event - NOW USING SQL DATABASE
app.post('/member/rsvp', verifyToken, isMember, async (req, res) => {
    try {
        const { eventId } = req.body;

        if (!eventId) {
            return res.status(400).json({ success: false, message: 'Event ID required!' });
        }

        const success = await db.rsvpToEvent(eventId, req.user.id);

        if (success === null) {
            return res.status(404).json({ success: false, message: 'Event not found!' });
        }

        if (!success) {
            return res.json({ success: true, message: 'Already RSVP\'d!' });
        }

        console.log(`🎟️ [SQL] RSVP successful for event ${eventId} by user ${req.user.username}`);

        res.json({ success: true, message: 'RSVP successful!' });
    } catch (error) {
        console.error('Error RSVP:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// Scan QR code for attendance
// Scan QR code for attendance - PURE SQL
app.post('/member/scan-attendance', verifyToken, isMember, async (req, res) => {
    try {
        const { eventId } = req.body;

        if (!eventId) {
            return res.status(400).json({ success: false, message: 'Event ID required!' });
        }

        // Get event using SQL
        const event = await db.findEventById(eventId);
        if (!event) {
            return res.status(404).json({ success: false, message: 'Event not found!' });
        }

        // Check if already attended using SQL
        const existingAttendance = await db.checkAttendance(eventId, req.user.id);
        if (existingAttendance) {
            return res.json({ success: true, message: 'Attendance already marked!' });
        }

        // Atomically mark attendance and award points in a single transaction
        const result = await db.markAttendanceWithPoints(
            event.id,
            req.user.id,
            event.clubId,
            10,
            `Attended Event: ${event.title}`,
            'System'
        );

        const points = result.success ? result.newPoints : 0;

        console.log(`✅ [SQL] Attendance marked for ${req.user.username} (Event: ${event.title})`);

        res.json({ success: true, message: 'Attendance marked! +10 points', points });
    } catch (error) {
        console.error('Error scanning attendance:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});



// Get attendance history
app.get('/member/attendance', verifyToken, isMember, async (req, res) => {
    try {
        const history = await db.getUserAttendanceHistory(req.user.id);

        const attendance = history.map(a => ({
            id: a.id,
            eventId: a.eventId,
            userId: a.userId,
            status: a.status,
            timestamp: a.timestamp,
            eventTitle: a.Event?.title || 'Unknown Event',
            eventDate: a.Event?.date || ''
        }));

        res.json({ success: true, attendance });
    } catch (error) {
        console.error('Error fetching attendance:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// Get leaderboard
app.get('/member/leaderboard', verifyToken, isMember, async (req, res) => {
    try {
        const { clubs: memberClubs, activeClub } = await resolveMemberClubContext(req.user.id);

        if (!memberClubs || memberClubs.length === 0) {
            // No club - return empty leaderboard
            return res.json({ success: true, leaderboard: [] });
        }

        // Get active club
        // Get club leaderboard using SQL
        const leaderboard = await db.getClubLeaderboard(activeClub.id, 50);

        // Mark current user
        const result = leaderboard.map(m => ({
            rank: m.rank,
            username: m.username,
            points: m.points,
            rankTitle: m.badge,
            isCurrentUser: m.id === req.user.id
        }));

        console.log(`📊 [SQL] Leaderboard fetched: ${result.length} members`);
        res.json({ success: true, leaderboard: result });
    } catch (error) {
        console.error('Error fetching leaderboard:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// Get announcements
// Get announcements - PURE SQL
app.get('/member/announcements', verifyToken, isMember, async (req, res) => {
    try {
        const { clubs: memberClubs, activeClubId, activeClub } = await resolveMemberClubContext(req.user.id);
        if (!memberClubs || memberClubs.length === 0) {
            return res.json({ success: true, announcements: [] });
        }
        const clubId = activeClubId || activeClub?.id || memberClubs[0].id;
        const announcements = await db.getAnnouncementsForUser(req.user.id, clubId);

        console.log(`📢 [SQL] Fetched ${announcements.length} announcements for member (clubId: ${clubId})`);

        res.json({ success: true, announcements });
    } catch (error) {
        console.error('Error fetching announcements:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// ========== POLLS (Member) ==========
app.get('/member/polls', verifyToken, isMember, async (req, res) => {
    try {
        const clubId = req.query.clubId ? parseInt(req.query.clubId, 10) : null;
        const polls = await db.getPollsForMember(req.user.id, clubId);
        res.json({ success: true, polls });
    } catch (error) {
        console.error('Error fetching polls:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.get('/member/polls/:id', verifyToken, isMember, async (req, res) => {
    try {
        const poll = await db.getPollById(parseInt(req.params.id, 10), { includeVoteCounts: true, userId: req.user.id });
        if (!poll) return res.status(404).json({ success: false, message: 'Poll not found!' });
        const memberClubs = await db.getUserClubs(req.user.id);
        const clubIds = (memberClubs || []).map(c => c.id);
        if (!clubIds.includes(poll.clubId)) return res.status(403).json({ success: false, message: 'Not a member of this club!' });
        res.json({ success: true, poll });
    } catch (error) {
        console.error('Error fetching poll:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.post('/member/polls/:id/vote', verifyToken, isMember, async (req, res) => {
    try {
        const pollId = parseInt(req.params.id, 10);
        const { optionId } = req.body;
        if (!optionId) return res.status(400).json({ success: false, message: 'optionId required!' });
        const result = await db.votePoll(pollId, parseInt(optionId, 10), req.user.id);
        if (!result.success) return res.status(400).json({ success: false, message: result.message || 'Cannot vote!' });
        const poll = await db.getPollById(pollId, { includeVoteCounts: true, userId: req.user.id });
        res.json({ success: true, message: 'Vote recorded!', poll });
    } catch (error) {
        console.error('Error voting:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// ========== PROJECT IDEAS & MY PROJECT (Member) ==========
app.get('/member/project-ideas', verifyToken, isMember, async (req, res) => {
    try {
        const clubId = req.query.clubId ? parseInt(req.query.clubId, 10) : null;
        const { clubs, activeClubId } = await resolveMemberClubContext(req.user.id);
        if (!clubs || clubs.length === 0) return res.json({ success: true, projectIdeas: [] });
        const targetClubId = clubId || activeClubId || clubs[0].id;
        const membership = await db.getMembership(req.user.id, targetClubId);
        if (!membership) return res.json({ success: true, projectIdeas: [] });
        const ideas = await db.getProjectIdeasByClubId(targetClubId);
        res.json({ success: true, projectIdeas: ideas });
    } catch (error) {
        console.error('Error fetching project ideas:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// OLD choose-project removed: frontend uses POST choose-project + GET my-projects (plural).
// Only the Sequelize handler (later in file) should handle add; old one wrote to different store.

app.get('/member/my-project', verifyToken, isMember, async (req, res) => {
    try {
        const clubId = req.query.clubId ? parseInt(req.query.clubId, 10) : null;
        const { clubs, activeClubId } = await resolveMemberClubContext(req.user.id);
        if (!clubs || clubs.length === 0) return res.json({ success: true, memberProject: null });
        const targetClubId = clubId || activeClubId || clubs[0].id;
        const mp = await db.getMemberProject(req.user.id, targetClubId);
        res.json({ success: true, memberProject: mp });
    } catch (error) {
        console.error('Error fetching my project:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.put('/member/my-project/progress', verifyToken, isMember, async (req, res) => {
    try {
        const { status, progressPercent } = req.body;
        const { clubs, activeClubId } = await resolveMemberClubContext(req.user.id);
        if (!clubs || clubs.length === 0) return res.status(400).json({ success: false, message: 'Not in any club!' });
        const clubId = req.body.clubId ? parseInt(req.body.clubId, 10) : (activeClubId || clubs[0].id);
        const mp = await db.updateMemberProjectProgress(req.user.id, clubId, { status, progressPercent });
        res.json({ success: true, message: 'Progress updated!', memberProject: mp.toJSON ? mp.toJSON() : mp });
    } catch (error) {
        console.error('Error updating progress:', error);
        res.status(400).json({ success: false, message: error.message || 'Cannot update!' });
    }
});

// Get user notifications
app.get('/member/notifications', verifyToken, isMember, async (req, res) => {
    try {
        const notifications = await db.getNotifications(req.user.id);
        res.json({ success: true, notifications });
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// Update member profile - NOW USING SQL DATABASE
app.put('/member/update-profile', verifyToken, isMember, async (req, res) => {
    try {
        const { username, bio, email, phone, department } = req.body;

        const member = await db.findUserById(req.user.id);
        if (!member) {
            return res.status(404).json({ success: false, message: 'Member not found!' });
        }

        // Check conflicts using SQL
        if (username && username !== member.username) {
            const exists = await db.userExists(null, username, null);
            if (exists) {
                const existingUser = await db.findUserByUsername(username);
                if (existingUser && existingUser.id !== member.id) {
                    return res.status(400).json({ success: false, message: 'Username already taken!' });
                }
            }
        }

        if (email && email !== member.email) {
            const existingUser = await db.findUserByEmail(email);
            if (existingUser && existingUser.id !== member.id) {
                return res.status(400).json({ success: false, message: 'Email already in use!' });
            }
        }

        // Prepare updates
        const updates = {};
        if (username) updates.username = username;
        if (email) updates.email = email;
        if (bio !== undefined) updates.bio = bio;
        if (phone !== undefined) updates.phone = phone;
        if (department !== undefined) updates.department = department;

        await db.updateUser(member.id, updates);

        console.log(`📝 [SQL] Profile updated for: ${username || member.username}`);

        res.json({
            success: true,
            message: 'Profile updated successfully!',
            profile: {
                username: updates.username || member.username,
                email: updates.email || member.email,
                bio: updates.bio || member.bio,
                phone: updates.phone || member.phone,
                department: updates.department || member.department,
                profilePic: member.profilePic
            }
        });
    } catch (error) {
        console.error('Error updating profile:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// Change Password - NOW USING SQL DATABASE
app.post('/member/change-password', verifyToken, isMember, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, message: 'Current and new passwords are required!' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ success: false, message: 'New password must be at least 6 characters!' });
        }

        const member = await db.findUserById(req.user.id);
        if (!member) {
            return res.status(404).json({ success: false, message: 'Member not found!' });
        }

        if (!member.password) {
            return res.status(400).json({ success: false, message: 'No password set for this account.' });
        }

        // Verify current password (support both plain-text and bcrypt-hashed)
        let currentValid = false;
        if (typeof member.password === 'string' && member.password.startsWith('$2')) {
            currentValid = await bcrypt.compare(currentPassword, member.password);
        } else {
            currentValid = (member.password === currentPassword);
        }

        if (!currentValid) {
            return res.status(400).json({ success: false, message: 'Incorrect current password!' });
        }

        // Hash and update with new password
        const newHash = await bcrypt.hash(newPassword, 10);
        await db.updateUser(member.id, { password: newHash });

        console.log(`🔐 [SQL] Password changed for: ${member.username}`);

        res.json({ success: true, message: 'Password changed successfully!' });
    } catch (error) {
        console.error('Error changing password:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// Delete Account - NOW USING SQL DATABASE
app.delete('/member/delete-account', verifyToken, isMember, async (req, res) => {
    try {
        const member = await db.findUserById(req.user.id);
        if (!member) {
            return res.status(404).json({ success: false, message: 'Member not found!' });
        }

        // Delete user
        const deleted = await db.deleteUser(member.id);

        if (deleted) {
            console.log(`🗑️ [SQL] Account deleted: ${member.username}`);
            res.json({ success: true, message: 'Account deleted successfully. Goodbye!' });
        } else {
            res.status(500).json({ success: false, message: 'Failed to delete account' });
        }
    } catch (error) {
        console.error('Error deleting account:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// Upload profile picture - NOW USING SQL DATABASE
app.post('/member/upload-profile-pic', verifyToken, isMember, upload.single('profilePic'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded!' });
        }

        const member = await db.findUserById(req.user.id);
        if (!member) {
            return res.status(404).json({ success: false, message: 'Member not found!' });
        }

        // Delete old profile pic if exists
        if (member.profilePic) {
            const oldPath = path.join(uploadsDir, path.basename(member.profilePic));
            if (fs.existsSync(oldPath)) {
                fs.unlinkSync(oldPath);
            }
        }

        const newPicPath = `/uploads/${req.file.filename}`;
        await db.updateUser(member.id, { profilePic: newPicPath });

        console.log(`📸 [SQL] Profile pic updated for: ${member.username}`);

        res.json({
            success: true,
            message: 'Profile picture updated!',
            profilePic: `${getBaseUrl(req)}${newPicPath}`
        });
    } catch (error) {
        console.error('Error uploading profile pic:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// Get member achievements (Universal)
app.get('/member/achievements', verifyToken, isMember, async (req, res) => {
    try {
        const member = await db.findUserById(req.user.id);
        if (!member) {
            return res.status(404).json({ success: false, message: 'Member not found!' });
        }

        const memberships = await db.getUserClubs(req.user.id);
        const attendanceCount = await db.Attendance.count({ where: { userId: req.user.id } });

        const totalPoints = (memberships || []).reduce((sum, m) => sum + (m.points || 0), 0);
        const ranks = (memberships || []).map(m => m.rank).filter(Boolean);

        const achievements = [];

        if (memberships && memberships.length > 0) {
            achievements.push({
                id: 'join_club',
                title: 'Club Member',
                icon: 'fa-solid fa-users',
                description: 'Joined your first club',
                unlocked: true,
                date: member.createdAt || new Date().toISOString()
            });
        }

        if (attendanceCount > 0) {
            achievements.push({
                id: 'first_event',
                title: 'First Event',
                icon: 'fa-solid fa-calendar-check',
                description: 'Attended your first event',
                unlocked: true,
                date: new Date().toISOString()
            });
        }

        if (attendanceCount >= 5) {
            achievements.push({
                id: 'regular_member',
                title: 'Regular',
                icon: 'fa-solid fa-star',
                description: 'Attended 5+ events',
                unlocked: true,
                date: new Date().toISOString()
            });
        }

        if (totalPoints >= 100) {
            achievements.push({
                id: 'point_collector',
                title: 'Point Collector',
                icon: 'fa-solid fa-coins',
                description: 'Earned 100+ points',
                unlocked: true,
                date: new Date().toISOString()
            });
        }

        if (ranks.includes('Gold') || ranks.includes('Platinum')) {
            achievements.push({
                id: 'top_rank',
                title: 'Elite Member',
                icon: 'fa-solid fa-crown',
                description: 'Reached Gold or Platinum rank',
                unlocked: true,
                date: new Date().toISOString()
            });
        }

        res.json({ success: true, achievements });
    } catch (error) {
        console.error('Error fetching achievements:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// Get member profile (Universal & Active Club Context)
app.get('/member/profile', verifyToken, isMember, async (req, res) => {
    try {
        const { member, clubs: memberClubs, activeClub } = await resolveMemberClubContext(req.user.id);
        if (!member) {
            return res.status(404).json({ success: false, message: 'Member not found!' });
        }

        // Calculate total points and build clubs data
        let totalPoints = 0;
        const clubsData = [];
        let activeClubPoints = 0;
        let activeClubRank = 'Rookie';

        for (const club of memberClubs) {
            totalPoints += club.points || 0;
            const clubDetails = await db.findClubById(club.id);
            clubsData.push({
                id: club.id,
                name: club.name,
                points: club.points,
                rank: club.rank,
                logo: clubDetails?.logo || ''
            });
        }

        if (activeClub) {
            activeClubPoints = activeClub.points || 0;
            activeClubRank = activeClub.rank || 'Rookie';
        }

        console.log(`📋 [SQL] Profile loaded for: ${member.username}`);

        res.json({
            success: true,
            profile: {
                username: member.username || '',
                email: member.email || '',
                studentId: member.studentId || '',
                bio: member.bio || '',
                phone: member.phone || '',
                department: member.department || '',
                profilePic: member.profilePic ? `${getBaseUrl(req)}${member.profilePic}` : '',

                // Active context
                points: activeClubPoints,
                rank: activeClubRank,

                // Universal context
                totalPoints: totalPoints,
                clubStats: clubsData,

                attendanceCount: 0,
                stats: { attendanceCount: 0, totalEvents: 0 },
                status: memberClubs.length > 0 ? 'active' : 'unassigned'
            }
        });
    } catch (error) {
        console.error('Error fetching profile:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// Get member's clubs - NOW USING SQL DATABASE
app.get('/member/my-clubs', verifyToken, isMember, async (req, res) => {
    try {
        const { member, clubs: memberClubs, activeClubId } = await resolveMemberClubContext(req.user.id);
        if (!member) {
            return res.status(404).json({ success: false, message: 'Member not found!' });
        }

        console.log(`📋 [SQL] Fetched ${memberClubs.length} clubs for member: ${member.username}`);

        res.json({
            success: true,
            clubs: memberClubs.map(c => ({
                id: c.id,
                name: c.name,
                logo: c.logo,
                tagline: c.tagline,
                isActive: activeClubId ? c.id === activeClubId : false
            })),
            activeClub: activeClubId || (memberClubs.length > 0 ? memberClubs[0].id : null)
        });
    } catch (error) {
        console.error('Error fetching clubs:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// DISABLED: Members CANNOT self-join clubs
// Only club owners can add members via Student ID
app.post('/member/join-club', verifyToken, isMember, (req, res) => {
    // Self-join is disabled for better organization
    // Members must be added by club owners using Student ID
    return res.status(403).json({
        success: false,
        message: 'You cannot join clubs directly. Please contact your club owner to add you using your Student ID.'
    });
});

// Switch active club - NOW USING SQL DATABASE (Simulated)
app.post('/member/switch-club', verifyToken, isMember, async (req, res) => {
    try {
        const { clubId } = req.body;

        if (!clubId) {
            return res.status(400).json({ success: false, message: 'Club ID required!' });
        }

        const membership = await db.getMembership(req.user.id, parseInt(clubId, 10));
        if (!membership) {
            return res.status(403).json({ success: false, message: 'You are not a member of this club!' });
        }
        await db.updateUser(req.user.id, { activeClubId: parseInt(clubId, 10) });
        console.log(`🔄 [SQL] Active club set to ID: ${clubId}`);

        res.json({
            success: true,
            message: `Switched club!`,
            activeClub: clubId
        });
    } catch (error) {
        console.error('Error switching club:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// Owner: Add member by student ID (CONFLICT-FREE with Data Manager)
// ONLY OWNERS CAN ADD - Members cannot self-join
// Add Member (By Student ID) - NOW USING SQL DATABASE
app.post('/owner/add-member', verifyToken, isOwner, async (req, res) => {
    try {
        const { studentId } = req.body;

        if (!studentId) {
            return res.status(400).json({ success: false, message: 'Student ID is required!' });
        }

        // Find owner's club using SQL
        const ownerClub = await db.findClubByOwnerId(req.user.id);

        if (!ownerClub) {
            return res.status(404).json({ success: false, message: 'Club not found!' });
        }

        // Find user by student ID using SQL
        const user = await db.findUserByStudentId(studentId);
        if (!user) {
            // User doesn't exist? In old system we might create? 
            // Better to say "Member not registered in the system"
            return res.status(404).json({ success: false, message: 'Student not found! They must register first.' });
        }

        // Add to club
        const { created } = await db.addMemberToClub(user.id, ownerClub.id);

        if (!created) {
            return res.json({ success: false, message: 'User is already a member of your club!' });
        }

        // Add default stats if needed logic? (Not stored in SQL yet except membership defaults)

        console.log(`✅ [SQL] Added member ${user.username} to club ${ownerClub.name}`);

        res.json({
            success: true,
            message: 'Member added successfully!',
            member: {
                id: user.id,
                username: user.username,
                email: user.email,
                studentId: user.studentId
            },
            clubName: ownerClub.name
        });
    } catch (error) {
        console.error('Error adding member:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// Member: Upload certificate
app.post('/member/upload-certificate', verifyToken, isMember, uploadCertificate.single('certificate'), async (req, res) => {
    try {
        const { title, clubId, eventId, issueDate, description } = req.body;

        if (!title || !clubId) {
            return res.status(400).json({ success: false, message: 'Title and Club are required!' });
        }

        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Certificate file is required!' });
        }
        const parsedClubId = parseInt(clubId);
        const parsedEventId = eventId ? parseInt(eventId) : null;

        // Ensure member belongs to club
        const membership = await db.getMembership(req.user.id, parsedClubId);
        if (!membership) {
            return res.status(403).json({ success: false, message: 'You are not a member of this club!' });
        }

        const club = await db.findClubById(parsedClubId);
        let event = null;
        if (parsedEventId) {
            event = await db.findEventById(parsedEventId);
            if (event && event.clubId !== parsedClubId) {
                return res.status(400).json({ success: false, message: 'Event does not belong to this club!' });
            }
        }

        const filepath = `/uploads/certificates/${req.file.filename}`;
        const created = await db.MemberCertificate.create({
            memberId: req.user.id,
            clubId: parsedClubId,
            eventId: parsedEventId,
            title,
            filename: req.file.filename,
            filepath,
            fileType: path.extname(req.file.filename).substring(1),
            issueDate: issueDate ? new Date(issueDate) : null,
            description: description || '',
            uploadedAt: new Date()
        });

        res.json({
            success: true,
            message: 'Certificate uploaded successfully!',
            certificate: {
                ...created.toJSON(),
                clubName: club?.name || 'Unknown Club',
                eventTitle: event?.title || null,
                fullpath: `${getBaseUrl(req)}${filepath}`
            }
        });
    } catch (error) {
        console.error('Error uploading certificate:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// Member: Get certificates
app.get('/member/certificates', verifyToken, isMember, async (req, res) => {
    try {
        const certificates = await db.MemberCertificate.findAll({
            where: { memberId: req.user.id },
            order: [['uploadedAt', 'DESC']]
        });

        const baseUrl = getBaseUrl(req);
        res.json({
            success: true,
            certificates: certificates.map(c => ({
                ...c.toJSON(),
                filepath: `${baseUrl}${c.filepath}`
            }))
        });
    } catch (error) {
        console.error('Error fetching certificates:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// Member: Delete certificate
app.delete('/member/certificate/:id', verifyToken, isMember, async (req, res) => {
    try {
        const certId = parseInt(req.params.id);
        const cert = await db.MemberCertificate.findOne({
            where: { id: certId, memberId: req.user.id }
        });

        if (!cert) {
            return res.status(404).json({ success: false, message: 'Certificate not found!' });
        }

        // Delete file
        const filePath = path.join(__dirname, 'uploads', 'certificates', cert.filename);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        await cert.destroy();

        res.json({ success: true, message: 'Certificate deleted successfully!' });
    } catch (error) {
        console.error('Error deleting certificate:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.get('/workshops', verifyToken, async (req, res) => {
    try {
        const user = await db.findUserById(req.user.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        let clubIds = [];
        if (user.role === 'admin') {
            const all = await db.Club.findAll({ attributes: ['id'] });
            clubIds = all.map(c => c.id);
        } else if (user.role === 'owner') {
            const ownerClub = await db.findClubByOwnerId(user.id);
            if (ownerClub) clubIds = [ownerClub.id];
        } else {
            const clubs = await db.getUserClubs(user.id);
            clubIds = clubs.map(c => c.id);
        }

        if (clubIds.length === 0) {
            return res.json({ success: true, workshops: [] });
        }

        const workshops = await db.Workshop.findAll({
            where: { clubId: { [Op.in]: clubIds } },
            include: [{ model: db.User, as: 'Instructor', attributes: ['id', 'username'] }],
            order: [['startTime', 'ASC']]
        });

        const payload = [];
        for (const w of workshops) {
            const liveSession = await db.WorkshopSession.findOne({
                where: {
                    workshopId: w.id,
                    [Op.or]: [
                        { status: { [Op.in]: ['LIVE', 'PAUSED'] } },
                        { isLive: true }
                    ]
                },
                order: [['createdAt', 'DESC']]
            });
            const resolvedStatus = resolveWorkshopStatusWithSession(w, liveSession);
            payload.push({
                id: w.id,
                title: w.title,
                description: w.description,
                startTime: w.startTime,
                endTime: w.endTime,
                status: resolvedStatus,
                requiredTools: w.requiredTools || [],
                instructor: w.Instructor ? { id: w.Instructor.id, username: w.Instructor.username } : null,
                attendeeCount: 0,
                liveSessionId: liveSession ? liveSession.id : null,
                sessionStatus: liveSession ? (liveSession.status || (liveSession.isLive ? 'LIVE' : 'DRAFT')) : null
            });
        }

        res.json({ success: true, workshops: payload });
    } catch (error) {
        console.error('Error listing workshops:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.get('/workshops/:id', verifyToken, async (req, res) => {
    try {
        const workshopId = parseInt(req.params.id);
        const workshop = await db.Workshop.findByPk(workshopId, {
            include: [{ model: db.User, as: 'Instructor', attributes: ['id', 'username'] }]
        });
        if (!workshop) return res.status(404).json({ success: false, message: 'Workshop not found' });

        const user = await db.findUserById(req.user.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        let hasAccess = false;
        if (user.role === 'admin') {
            hasAccess = true;
        } else if (user.role === 'owner') {
            const ownerClub = await db.findClubByOwnerId(user.id);
            hasAccess = ownerClub && ownerClub.id === workshop.clubId;
        } else {
            const membership = await db.getMembership(user.id, workshop.clubId);
            hasAccess = !!membership;
        }
        if (!hasAccess) return res.status(403).json({ success: false, message: 'Access denied' });

        const liveSession = await db.WorkshopSession.findOne({
            where: {
                workshopId: workshop.id,
                [Op.or]: [
                    { status: { [Op.in]: ['LIVE', 'PAUSED'] } },
                    { isLive: true }
                ]
            },
            order: [['createdAt', 'DESC']]
        });
        const resolvedStatus = resolveWorkshopStatusWithSession(workshop, liveSession);

        res.json({
            success: true,
            workshop: {
                id: workshop.id,
                title: workshop.title,
                description: workshop.description,
                startTime: workshop.startTime,
                endTime: workshop.endTime,
                status: resolvedStatus,
                requiredTools: workshop.requiredTools || [],
                instructor: workshop.Instructor ? { id: workshop.Instructor.id, username: workshop.Instructor.username } : null,
                clubId: workshop.clubId,
                liveSessionId: liveSession ? liveSession.id : null,
                sessionStatus: liveSession ? (liveSession.status || (liveSession.isLive ? 'LIVE' : 'DRAFT')) : null,
                isLive: resolvedStatus === 'live'
            }
        });
    } catch (error) {
        console.error('Error fetching workshop:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.delete('/workshops/:id', verifyToken, isOwner, async (req, res) => {
    try {
        const workshopId = parseInt(req.params.id, 10);
        if (!workshopId) return res.status(400).json({ success: false, message: 'Workshop ID required!' });
        const workshop = await db.Workshop.findByPk(workshopId);
        if (!workshop) return res.status(404).json({ success: false, message: 'Workshop not found' });
        const ownerClub = await db.findClubByOwnerId(req.user.id);
        if (!ownerClub || ownerClub.id !== workshop.clubId) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }
        const t = await db.sequelize.transaction();
        try {
            await deleteWorkshopWithRelations(workshopId, t);
            await t.commit();
            res.json({ success: true, message: 'Workshop deleted!' });
        } catch (error) {
            await t.rollback();
            throw error;
        }
    } catch (error) {
        console.error('Error deleting workshop:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.get('/workshops/:id/tools', verifyToken, async (req, res) => {
    try {
        const workshop = await db.Workshop.findByPk(parseInt(req.params.id));
        if (!workshop) return res.status(404).json({ success: false, message: 'Workshop not found' });
        res.json({ success: true, tools: workshop.requiredTools || [] });
    } catch (error) {
        console.error('Error loading tools:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.post('/workshops', verifyToken, isOwner, async (req, res) => {
    try {
        const { title, description, startTime, endTime, requiredTools } = req.body;
        if (!title) return res.status(400).json({ success: false, message: 'Title is required' });
        const ownerClub = await db.findClubByOwnerId(req.user.id);
        if (!ownerClub) return res.status(404).json({ success: false, message: 'Club not found' });

        const parsedStart = startTime ? new Date(startTime) : null;
        if (startTime && isNaN(parsedStart.getTime())) {
            return res.status(400).json({ success: false, message: 'Invalid start time' });
        }
        const parsedEnd = endTime ? new Date(endTime) : null;
        if (endTime && isNaN(parsedEnd.getTime())) {
            return res.status(400).json({ success: false, message: 'Invalid end time' });
        }
        if (parsedStart && parsedEnd && parsedEnd < parsedStart) {
            return res.status(400).json({ success: false, message: 'End time must be after start time' });
        }

        let toolsPayload = requiredTools;
        if (typeof requiredTools === 'string') {
            try {
                toolsPayload = JSON.parse(requiredTools);
            } catch (error) {
                toolsPayload = [];
            }
        }

        const workshop = await db.Workshop.create({
            title: String(title).trim(),
            description: String(description || '').trim(),
            instructorId: req.user.id,
            clubId: ownerClub.id,
            startTime: parsedStart,
            endTime: parsedEnd,
            status: 'upcoming',
            requiredTools: normalizeTools(toolsPayload)
        });

        res.json({ success: true, workshop });
    } catch (error) {
        console.error('Error creating workshop:', error);
        res.status(500).json({
            success: false,
            message: 'Server error!',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

app.post('/workshops/:id/session/start', verifyToken, isOwner, async (req, res) => {
    try {
        const workshopId = parseInt(req.params.id);
        const workshop = await db.Workshop.findByPk(workshopId);
        if (!workshop) return res.status(404).json({ success: false, message: 'Workshop not found' });
        const ownerClub = await db.findClubByOwnerId(req.user.id);
        if (!ownerClub || ownerClub.id !== workshop.clubId) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const existingLive = await db.WorkshopSession.findOne({
            where: {
                workshopId: workshop.id,
                [Op.or]: [
                    { status: { [Op.in]: ['LIVE', 'PAUSED'] } },
                    { isLive: true }
                ]
            },
            order: [['createdAt', 'DESC']]
        });
        if (existingLive) {
            if (existingLive.status === 'PAUSED' || existingLive.isLive === false) {
                await existingLive.update({
                    status: 'LIVE',
                    isLive: true,
                    startedAt: existingLive.startedAt || new Date()
                });
                await workshop.update({ status: 'live' });
                emitWorkshopEvent(existingLive.id, 'SESSION_STARTED', {
                    session_id: existingLive.id,
                    workshop_id: workshop.id
                });
            }
            return res.json({ success: true, session: existingLive });
        }

        const session = await db.WorkshopSession.create({
            workshopId: workshop.id,
            sessionToken: generateNonce(),
            isLive: true,
            status: 'LIVE',
            startedAt: new Date(),
            previewEnabled: false,
            isSectionsPublished: false
        });

        await workshop.update({ status: 'live' });

        emitWorkshopEvent(session.id, 'SESSION_STARTED', {
            session_id: session.id,
            workshop_id: workshop.id
        });

        res.json({ success: true, session });
    } catch (error) {
        console.error('Error starting session:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.post('/sessions/:id/pause', verifyToken, isOwner, async (req, res) => {
    try {
        const sessionId = parseInt(req.params.id);
        const session = await db.WorkshopSession.findByPk(sessionId, {
            include: [{ model: db.Workshop }]
        });
        if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
        const ownerClub = await db.findClubByOwnerId(req.user.id);
        if (!ownerClub || ownerClub.id !== session.Workshop.clubId) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        await session.update({
            status: 'PAUSED',
            isLive: false
        });
        await session.Workshop.update({ status: 'paused' });

        res.json({ success: true, session });
    } catch (error) {
        console.error('Error pausing session:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.post('/sessions/:id/end', verifyToken, isOwner, async (req, res) => {
    try {
        const sessionId = parseInt(req.params.id);
        const session = await db.WorkshopSession.findByPk(sessionId, {
            include: [{ model: db.Workshop }]
        });
        if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
        const ownerClub = await db.findClubByOwnerId(req.user.id);
        if (!ownerClub || ownerClub.id !== session.Workshop.clubId) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        await session.update({
            status: 'ENDED',
            isLive: false,
            endedAt: new Date()
        });
        await session.Workshop.update({ status: 'ended' });

        emitWorkshopEvent(session.id, 'SESSION_ENDED', {
            session_id: session.id,
            workshop_id: session.Workshop.id
        });

        res.json({ success: true, session });
    } catch (error) {
        console.error('Error ending session:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.get('/sessions/:id/state', verifyToken, async (req, res) => {
    try {
        const sessionId = parseInt(req.params.id);
        const session = await db.WorkshopSession.findByPk(sessionId, {
            include: [{ model: db.Workshop }]
        });
        if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

        const user = await db.findUserById(req.user.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        let hasAccess = false;
        if (user.role === 'admin') {
            hasAccess = true;
        } else if (user.role === 'owner') {
            const ownerClub = await db.findClubByOwnerId(user.id);
            hasAccess = ownerClub && ownerClub.id === session.Workshop.clubId;
        } else {
            const membership = await db.getMembership(user.id, session.Workshop.clubId);
            hasAccess = !!membership;
        }
        if (!hasAccess) return res.status(403).json({ success: false, message: 'Access denied' });

        const isMember = user.role === 'member';
        const latestBundle = await db.CodeBundle.findOne({
            where: {
                sessionId: session.id,
                ...(isMember ? { isPublished: true } : {})
            },
            order: [['versionNumber', 'DESC']]
        });

        const totalSectionsCount = await db.CodeSection.count({
            where: { sessionId: session.id }
        });

        const sections = await db.CodeSection.findAll({
            where: {
                sessionId: session.id,
                ...(isMember ? { visible: true } : {})
            },
            order: [['orderIndex', 'ASC']]
        });

        res.json({
            success: true,
            session: {
                id: session.id,
                workshopId: session.workshopId,
                isLive: session.status === 'LIVE' || session.isLive,
                status: session.status || (session.isLive ? 'LIVE' : 'DRAFT'),
                previewEnabled: session.previewEnabled,
                isSectionsPublished: session.isSectionsPublished,
                hasSections: totalSectionsCount > 0,
                sessionToken: session.sessionToken
            },
            bundle: latestBundle,
            sections
        });
    } catch (error) {
        console.error('Error loading session state:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.post('/sessions/:id/code/save', verifyToken, isOwner, async (req, res) => {
    try {
        const sessionId = parseInt(req.params.id);
        const { rawCode, language, publish } = req.body;
        if (typeof rawCode !== 'string') {
            return res.status(400).json({ success: false, message: 'rawCode is required' });
        }
        const session = await db.WorkshopSession.findByPk(sessionId, {
            include: [{ model: db.Workshop }]
        });
        if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
        const ownerClub = await db.findClubByOwnerId(req.user.id);
        if (!ownerClub || ownerClub.id !== session.Workshop.clubId) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const latestBundle = await db.CodeBundle.findOne({
            where: { sessionId: session.id },
            order: [['versionNumber', 'DESC']]
        });
        const nextVersion = latestBundle ? latestBundle.versionNumber + 1 : 1;

        const bundle = await db.CodeBundle.create({
            sessionId: session.id,
            authorId: req.user.id,
            language: String(language || 'plaintext'),
            rawCode,
            savedAt: new Date(),
            versionNumber: nextVersion,
            isPublished: publish !== false
        });

        const sections = await db.CodeSection.findAll({
            where: { sessionId: session.id },
            order: [['orderIndex', 'ASC']]
        });

        const updatedSections = [];
        for (const section of sections) {
            const content = sliceCodeByLines(rawCode, section.startLine, section.endLine);
            await section.update({
                content,
                codeBundleId: bundle.id
            });
            updatedSections.push(section);
        }

        await db.RealtimeEventLog.create({
            sessionId: session.id,
            eventType: 'CODE_UPDATED',
            actorId: req.user.id,
            payload: { bundleId: bundle.id, version: bundle.versionNumber, isPublished: bundle.isPublished }
        });

        emitWorkshopEvent(session.id, 'CODE_UPDATED', {
            session_id: session.id,
            bundle_id: bundle.id,
            version: bundle.versionNumber,
            raw_code: bundle.rawCode,
            language: bundle.language,
            is_published: bundle.isPublished,
            author_id: req.user.id,
            timestamp: bundle.savedAt,
            sections: updatedSections.map(s => ({
                id: s.id,
                start: s.startLine,
                end: s.endLine,
                content: s.content,
                visible: s.visible,
                order: s.orderIndex,
                name: s.name,
                language: s.language
            }))
        });

        res.json({ success: true, bundle, sections: updatedSections });
    } catch (error) {
        console.error('Error saving code:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.post('/sessions/:id/sections', verifyToken, isOwner, async (req, res) => {
    try {
        const sessionId = parseInt(req.params.id);
        const { sections = [], removeIds = [] } = req.body;
        const session = await db.WorkshopSession.findByPk(sessionId, {
            include: [{ model: db.Workshop }]
        });
        if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
        const ownerClub = await db.findClubByOwnerId(req.user.id);
        if (!ownerClub || ownerClub.id !== session.Workshop.clubId) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const latestBundle = await db.CodeBundle.findOne({
            where: { sessionId: session.id },
            order: [['versionNumber', 'DESC']]
        });
        const rawCode = latestBundle ? latestBundle.rawCode : '';

        if (removeIds.length > 0) {
            await db.CodeSection.destroy({ where: { id: { [Op.in]: removeIds }, sessionId: session.id } });
        }

        const existing = await db.CodeSection.findAll({ where: { sessionId: session.id } });
        const candidateRanges = [];
        for (const item of existing) {
            if (removeIds.includes(item.id)) continue;
            candidateRanges.push({ id: item.id, start: item.startLine, end: item.endLine });
        }
        for (const section of sections) {
            const start = parseInt(section.startLine);
            const end = parseInt(section.endLine);
            if (!start || !end || start > end) {
                return res.status(400).json({ success: false, message: 'Invalid section range' });
            }
            candidateRanges.push({ id: section.id || null, start, end });
        }
        for (let i = 0; i < candidateRanges.length; i++) {
            for (let j = i + 1; j < candidateRanges.length; j++) {
                const a = candidateRanges[i];
                const b = candidateRanges[j];
                if (a.id && b.id && a.id === b.id) continue;
                if (a.start <= b.end && b.start <= a.end) {
                    return res.status(400).json({ success: false, message: 'Overlapping sections are not allowed' });
                }
            }
        }

        const updatedSections = [];
        for (const section of sections) {
            const content = sliceCodeByLines(rawCode, section.startLine, section.endLine);
            if (section.id) {
                const existingSection = await db.CodeSection.findOne({ where: { id: section.id, sessionId: session.id } });
                if (!existingSection) continue;
                await existingSection.update({
                    name: String(section.name || existingSection.name),
                    startLine: parseInt(section.startLine),
                    endLine: parseInt(section.endLine),
                    language: String(section.language || existingSection.language || 'plaintext'),
                    visible: section.visible !== undefined ? !!section.visible : existingSection.visible,
                    orderIndex: section.orderIndex !== undefined ? parseInt(section.orderIndex) : existingSection.orderIndex,
                    content,
                    codeBundleId: latestBundle ? latestBundle.id : existingSection.codeBundleId
                });
                updatedSections.push(existingSection);
            } else {
                const created = await db.CodeSection.create({
                    sessionId: session.id,
                    codeBundleId: latestBundle ? latestBundle.id : null,
                    name: String(section.name || `Section ${existing.length + updatedSections.length + 1}`),
                    startLine: parseInt(section.startLine),
                    endLine: parseInt(section.endLine),
                    language: String(section.language || 'plaintext'),
                    visible: !!section.visible,
                    orderIndex: section.orderIndex !== undefined ? parseInt(section.orderIndex) : existing.length + updatedSections.length,
                    content
                });
                updatedSections.push(created);
            }
        }

        await db.RealtimeEventLog.create({
            sessionId: session.id,
            eventType: 'SECTIONS_UPDATED',
            actorId: req.user.id,
            payload: { sectionCount: updatedSections.length }
        });

        res.json({ success: true, sections: updatedSections });
    } catch (error) {
        console.error('Error updating sections:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.post('/sessions/:id/publish-sections', verifyToken, isOwner, async (req, res) => {
    try {
        const sessionId = parseInt(req.params.id);
        const { visibleSectionIds = [], order = [] } = req.body;
        const session = await db.WorkshopSession.findByPk(sessionId, {
            include: [{ model: db.Workshop }]
        });
        if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
        const ownerClub = await db.findClubByOwnerId(req.user.id);
        if (!ownerClub || ownerClub.id !== session.Workshop.clubId) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const sections = await db.CodeSection.findAll({ where: { sessionId: session.id } });
        const visibleSet = new Set(visibleSectionIds.map(id => parseInt(id)));

        for (const section of sections) {
            const nextVisible = visibleSet.has(section.id);
            const nextOrderIndex = order.length ? order.indexOf(section.id) : section.orderIndex;
            await section.update({
                visible: nextVisible,
                orderIndex: nextOrderIndex >= 0 ? nextOrderIndex : section.orderIndex
            });
        }

        await session.update({ isSectionsPublished: true });

        await db.RealtimeEventLog.create({
            sessionId: session.id,
            eventType: 'SECTIONS_PUBLISHED',
            actorId: req.user.id,
            payload: { visibleSectionIds }
        });

        const visibleSections = sections
            .filter(section => visibleSet.has(section.id))
            .sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0))
            .map(s => ({
                id: s.id,
                start: s.startLine,
                end: s.endLine,
                content: s.content,
                visible: s.visible,
                order: s.orderIndex,
                name: s.name,
                language: s.language
            }));

        emitWorkshopEvent(session.id, 'SECTIONS_PUBLISHED', {
            session_id: session.id,
            visible_section_ids: visibleSectionIds,
            sections: visibleSections
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Error publishing sections:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.post('/sessions/:id/preview', verifyToken, isOwner, async (req, res) => {
    try {
        const sessionId = parseInt(req.params.id);
        const { enabled } = req.body;
        const session = await db.WorkshopSession.findByPk(sessionId, {
            include: [{ model: db.Workshop }]
        });
        if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
        const ownerClub = await db.findClubByOwnerId(req.user.id);
        if (!ownerClub || ownerClub.id !== session.Workshop.clubId) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        await session.update({ previewEnabled: !!enabled });

        await db.RealtimeEventLog.create({
            sessionId: session.id,
            eventType: 'PREVIEW_TOGGLED',
            actorId: req.user.id,
            payload: { enabled: !!enabled }
        });

        emitWorkshopEvent(session.id, 'PREVIEW_TOGGLED', {
            session_id: session.id,
            enabled: !!enabled
        });

        res.json({ success: true, previewEnabled: session.previewEnabled });
    } catch (error) {
        console.error('Error updating preview:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// ========== SOCKET.IO SETUP ==========
const workshopParticipants = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    let decoded = null;
    const authToken = socket.handshake.auth && socket.handshake.auth.token;
    if (authToken) {
        try {
            decoded = jwt.verify(authToken, JWT_SECRET);
        } catch (error) {
            decoded = null;
        }
    }
    if (decoded) {
        socket.data.userId = decoded.id;
        socket.data.role = decoded.role;
    }

    socket.on('join-club', (clubId) => {
        socket.join(`club-${clubId}`);
        console.log(`Socket ${socket.id} joined club-${clubId}`);
    });

    socket.on('join-user', (userId) => {
        socket.join(`user-${userId}`);
        console.log(`Socket ${socket.id} joined user-${userId}`);
    });

    socket.on('join-workshop-session', (sessionId) => {
        const parsed = parseInt(sessionId);
        if (!parsed) return;
        socket.join(`workshop-session-${parsed}`);
        socket.data.workshopSessionId = parsed;
        if (!workshopParticipants.has(parsed)) {
            workshopParticipants.set(parsed, new Set());
        }
        workshopParticipants.get(parsed).add(socket.id);
        const count = workshopParticipants.get(parsed).size;
        emitWorkshopEvent(parsed, 'PARTICIPANT_COUNT_UPDATED', {
            session_id: parsed,
            count,
            user_id: socket.data.userId || null,
            role: socket.data.role || null
        });
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        const sessionId = socket.data.workshopSessionId;
        if (sessionId && workshopParticipants.has(sessionId)) {
            const set = workshopParticipants.get(sessionId);
            set.delete(socket.id);
            const count = set.size;
            emitWorkshopEvent(sessionId, 'PARTICIPANT_COUNT_UPDATED', {
                session_id: sessionId,
                count,
                user_id: socket.data.userId || null,
                role: socket.data.role || null
            });
            if (count === 0) workshopParticipants.delete(sessionId);
        }
    });
});

// ========== MEMBER ROLES MIDDLEWARE ==========

function isAdminOrModerator(req, res, next) {
    db.findUserById(req.user.id).then(user => {
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found!' });
        }

        // SQL-only: allow global admins and club owners.
        if (user.role === 'owner' || user.role === 'admin') {
            next();
        } else {
            return res.status(403).json({
                success: false,
                message: 'Access denied!'
            });
        }
    }).catch(err => {
        console.error('isAdminOrModerator error:', err);
        return res.status(500).json({ success: false, message: 'Server error!' });
    });
}

// ========== ATTENDANCE TAKING BY ADMIN/MODERATOR/OWNER ==========

app.post('/owner/take-attendance', verifyToken, isAdminOrModerator, async (req, res) => {
    try {
        const { eventId, memberIds } = req.body;

        if (!eventId || !memberIds || !Array.isArray(memberIds)) {
            return res.status(400).json({
                success: false,
                message: 'Event ID and member IDs array required!'
            });
        }

        const user = await db.findUserById(req.user.id);
        if (!user || user.role !== 'owner') {
            return res.status(403).json({ success: false, message: 'Access denied!' });
        }

        const ownerClub = await db.findClubByOwnerId(user.id);
        if (!ownerClub) {
            return res.status(404).json({ success: false, message: 'Club not found!' });
        }

        const event = await db.findEventById(parseInt(eventId));
        if (!event) {
            return res.status(404).json({ success: false, message: 'Event not found!' });
        }

        if (event.clubId !== ownerClub.id) {
            return res.status(403).json({ success: false, message: 'Access denied!' });
        }

        const createdAttendances = [];

        for (const rawMemberId of memberIds) {
            const memberId = parseInt(rawMemberId);
            if (!memberId) continue;

            const membership = await db.getMembership(memberId, ownerClub.id);
            if (!membership) continue; // not in this club

            const [attendance, created] = await db.Attendance.findOrCreate({
                where: { eventId: event.id, userId: memberId },
                defaults: { status: 'present', timestamp: new Date() }
            });

            if (!created) continue;

            createdAttendances.push(attendance);

            await db.awardPoints(
                memberId,
                ownerClub.id,
                10,
                `Attendance: ${event.title}`,
                user.username
            );

            await createSqlNotification(memberId, {
                type: 'event',
                title: 'Attendance Marked',
                message: `Your attendance has been marked for event: ${event.title}`
            });
        }

        const count = await db.Attendance.count({ where: { eventId: event.id } });

        io.to(`club-${event.clubId}`).emit('attendance-updated', {
            eventId: event.id,
            count
        });

        return res.json({
            success: true,
            message: `Marked attendance for ${createdAttendances.length} member(s)!`,
            attendances: createdAttendances
        });
    } catch (error) {
        console.error('Error taking attendance:', error);
        return res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// ========== QR-BASED ATTENDANCE SYSTEM ==========

// Start attendance session (Owner)
app.post('/attendance/session/start', verifyToken, isOwner, async (req, res) => {
    try {
        const { eventId, expiryMinutes = 30 } = req.body;

        if (!eventId) {
            return res.status(400).json({ success: false, message: 'Event ID required!' });
        }

        // Get owner's club
        const ownerClub = await db.findClubByOwnerId(req.user.id);
        if (!ownerClub) {
            return res.status(404).json({ success: false, message: 'Club not found!' });
        }

        // Find event
        const event = await db.findEventById(parseInt(eventId));
        if (!event) {
            return res.status(404).json({ success: false, message: 'Event not found!' });
        }

        // Verify event belongs to owner's club
        if (event.clubId !== ownerClub.id) {
            return res.status(403).json({ success: false, message: 'Access denied!' });
        }

        // Check for existing active session
        const existingSession = await db.AttendanceSession.findOne({
            where: { eventId: event.id, status: 'active' }
        });

        if (existingSession) {
            // Return existing session with fresh token and code
            const nonce = generateNonce();
            const code = generateAttendanceCode();
            existingSession.currentNonce = nonce;
            existingSession.currentCode = code;
            existingSession.expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);
            await existingSession.save();

            const token = generateAttendanceToken(existingSession.id, event.id, nonce, 30);

            return res.json({
                success: true,
                message: 'Session already active',
                session: {
                    id: existingSession.id,
                    eventId: event.id,
                    eventTitle: event.title,
                    status: existingSession.status,
                    expiresAt: existingSession.expiresAt,
                    token,
                    code
                }
            });
        }

        // Create new session
        const nonce = generateNonce();
        const code = generateAttendanceCode();
        const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

        const session = await db.AttendanceSession.create({
            eventId: event.id,
            ownerId: req.user.id,
            status: 'active',
            expiresAt,
            currentNonce: nonce,
            currentCode: code
        });

        const token = generateAttendanceToken(session.id, event.id, nonce, 30);

        console.log(`✅ [QR] Attendance session started for event: ${event.title}`);

        res.json({
            success: true,
            message: 'Attendance session started!',
            session: {
                id: session.id,
                eventId: event.id,
                eventTitle: event.title,
                status: session.status,
                expiresAt: session.expiresAt,
                token,
                code
            }
        });
    } catch (error) {
        console.error('Error starting attendance session:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// Get fresh QR token (auto-refresh every 25s)
app.get('/attendance/session/:id/token', verifyToken, isOwner, async (req, res) => {
    try {
        const sessionId = parseInt(req.params.id);

        const session = await db.AttendanceSession.findByPk(sessionId, {
            include: [{ model: db.Event }]
        });

        if (!session) {
            return res.status(404).json({ success: false, message: 'Session not found!' });
        }

        if (session.ownerId !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Access denied!' });
        }

        if (session.status !== 'active') {
            return res.status(400).json({ success: false, message: 'Session is closed!' });
        }

        // Check if session expired
        if (new Date() > new Date(session.expiresAt)) {
            session.status = 'closed';
            await session.save();
            return res.status(400).json({ success: false, message: 'Session has expired!' });
        }

        // Generate new nonce, code and token
        const nonce = generateNonce();
        const code = generateAttendanceCode();
        session.currentNonce = nonce;
        session.currentCode = code;
        session.expiresAt = new Date(Date.now() + 30 * 60 * 1000);
        await session.save();

        const token = generateAttendanceToken(session.id, session.eventId, nonce, 30);

        res.json({
            success: true,
            token,
            code,
            expiresAt: session.expiresAt,
            timeLeft: Math.max(0, Math.floor((new Date(session.expiresAt) - new Date()) / 1000))
        });
    } catch (error) {
        console.error('Error refreshing token:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// Scan QR for attendance (Member)
app.post('/attendance/scan', verifyToken, isMember, async (req, res) => {
    try {
        const { token, deviceHash } = req.body;

        if (!token) {
            return res.status(400).json({ success: false, message: 'QR token required!' });
        }

        // 1. Verify token signature and expiry
        const tokenData = verifyAttendanceToken(token);
        if (!tokenData.valid) {
            return res.status(400).json({ success: false, message: tokenData.error || 'Invalid QR code!' });
        }

        // 2. Find session
        const session = await db.AttendanceSession.findByPk(tokenData.sessionId, {
            include: [{ model: db.Event }]
        });

        if (!session) {
            return res.status(404).json({ success: false, message: 'Session not found!' });
        }

        // 3. Check session is active
        if (session.status !== 'active') {
            return res.status(400).json({ success: false, message: 'Attendance session has ended!' });
        }

        // 4. Check session not expired
        if (new Date() > new Date(session.expiresAt)) {
            session.status = 'closed';
            await session.save();
            return res.status(400).json({ success: false, message: 'Attendance session has expired!' });
        }

        // 5. Verify nonce matches current nonce
        if (tokenData.nonce !== session.currentNonce) {
            return res.status(400).json({ success: false, message: 'QR code expired! Please scan the new QR.' });
        }

        if (tokenData.eventId && tokenData.eventId !== session.eventId) {
            return res.status(400).json({ success: false, message: 'Invalid QR code for this event!' });
        }

        // 6. Verify member belongs to event's club
        const membership = await db.getMembership(req.user.id, session.Event.clubId);
        if (!membership) {
            return res.status(403).json({ success: false, message: 'You are not a member of this club!' });
        }

        const t = await db.sequelize.transaction();
        let checkedInAt = new Date();
        try {
            const [record, created] = await db.AttendanceRecord.findOrCreate({
                where: { sessionId: session.id, memberId: req.user.id },
                defaults: {
                    sessionId: session.id,
                    eventId: session.eventId,
                    memberId: req.user.id,
                    deviceHash: deviceHash || null,
                    checkedInAt
                },
                transaction: t
            });

            if (!created) {
                await t.rollback();
                return res.json({ success: true, message: 'Attendance already marked!', checkedInAt: record.checkedInAt });
            }

            await db.Attendance.findOrCreate({
                where: { eventId: session.eventId, userId: req.user.id },
                defaults: { status: 'present', timestamp: checkedInAt },
                transaction: t
            });

            const pointsResult = await db.awardPoints(
                req.user.id,
                session.Event.clubId,
                10,
                `Attended Event: ${session.Event.title}`,
                'System',
                { transaction: t }
            );

            if (!pointsResult.success) {
                throw new Error(pointsResult.error || 'Failed to award points');
            }

            await t.commit();
        } catch (err) {
            await t.rollback();
            throw err;
        }

        // Check if late (5 min after event start)
        let isLate = false;
        if (session.Event.startTime) {
            const lateThreshold = new Date(session.Event.startTime);
            lateThreshold.setMinutes(lateThreshold.getMinutes() + 5);
            isLate = checkedInAt > lateThreshold;
        }

        console.log(`✅ [QR] Attendance marked for ${req.user.username} (Event: ${session.Event.title})${isLate ? ' [LATE]' : ''}`);

        // Emit real-time update to owner
        io.to(`user-${session.ownerId}`).emit('attendance-scan', {
            sessionId: session.id,
            memberId: req.user.id,
            memberName: req.user.username,
            isLate,
            checkedInAt
        });

        res.json({
            success: true,
            message: isLate ? 'Attendance marked! (Late) +10 points' : 'Attendance marked! +10 points',
            isLate,
            checkedInAt
        });
    } catch (error) {
        console.error('Error scanning attendance:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// Scan attendance via 7-digit CODE (Member)
app.post('/attendance/scan-code', verifyToken, isMember, async (req, res) => {
    try {
        const { code, deviceHash } = req.body;

        if (!code || code.length !== 7) {
            return res.status(400).json({ success: false, message: 'Invalid code! Must be 7 characters.' });
        }

        const upperCode = code.toUpperCase();

        // Find active session with matching code
        const session = await db.AttendanceSession.findOne({
            where: {
                currentCode: upperCode,
                status: 'active'
            },
            include: [{ model: db.Event }]
        });

        if (!session) {
            return res.status(400).json({ success: false, message: 'Invalid or expired code!' });
        }

        // Check if session expired
        if (new Date() > new Date(session.expiresAt)) {
            session.status = 'closed';
            await session.save();
            return res.status(400).json({ success: false, message: 'Session has expired!' });
        }

        // Check membership
        const membership = await db.Membership.findOne({
            where: { userId: req.user.id, clubId: session.Event.clubId }
        });

        if (!membership) {
            return res.status(403).json({ success: false, message: 'You are not a member of this club!' });
        }

        const t = await db.sequelize.transaction();
        let checkedInAt = new Date();
        try {
            const [record, created] = await db.AttendanceRecord.findOrCreate({
                where: { sessionId: session.id, memberId: req.user.id },
                defaults: {
                    sessionId: session.id,
                    eventId: session.eventId,
                    memberId: req.user.id,
                    checkedInAt,
                    deviceHash: deviceHash || null
                },
                transaction: t
            });

            if (!created) {
                await t.rollback();
                return res.json({ success: true, message: 'Already checked in!', checkedInAt: record.checkedInAt });
            }

            await db.Attendance.findOrCreate({
                where: { eventId: session.eventId, userId: req.user.id },
                defaults: { status: 'present', timestamp: checkedInAt },
                transaction: t
            });

            const pointsResult = await db.awardPoints(
                req.user.id,
                session.Event.clubId,
                10,
                `Attended Event: ${session.Event.title}`,
                'System',
                { transaction: t }
            );

            if (!pointsResult.success) {
                throw new Error(pointsResult.error || 'Failed to award points');
            }

            await t.commit();
        } catch (err) {
            await t.rollback();
            throw err;
        }

        // Check if late
        let isLate = false;
        if (session.Event.startTime) {
            const lateThreshold = new Date(session.Event.startTime);
            lateThreshold.setMinutes(lateThreshold.getMinutes() + 5);
            isLate = checkedInAt > lateThreshold;
        }

        console.log(`✅ [CODE] Attendance marked for ${req.user.username} (Event: ${session.Event.title})${isLate ? ' [LATE]' : ''}`);

        // Emit real-time update
        io.to(`user-${session.ownerId}`).emit('attendance-scan', {
            sessionId: session.id,
            memberId: req.user.id,
            memberName: req.user.username,
            isLate,
            checkedInAt
        });

        res.json({
            success: true,
            message: isLate ? 'Attendance marked! (Late) +10 points' : 'Attendance marked! +10 points',
            isLate,
            checkedInAt
        });
    } catch (error) {
        console.error('Error scanning code:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// Get live attendance summary (Owner)
app.get('/attendance/session/:id/summary', verifyToken, isOwner, async (req, res) => {
    try {
        const sessionId = parseInt(req.params.id);

        const session = await db.AttendanceSession.findByPk(sessionId, {
            include: [{ model: db.Event }]
        });

        if (!session) {
            return res.status(404).json({ success: false, message: 'Session not found!' });
        }

        if (session.ownerId !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Access denied!' });
        }

        const records = await db.AttendanceRecord.findAll({
            where: { eventId: session.eventId },
            include: [{ model: db.User, as: 'Member', attributes: ['id', 'username', 'email', 'studentId'] }],
            order: [['checkedInAt', 'DESC']]
        });

        const manualAttendances = await db.Attendance.findAll({
            where: { eventId: session.eventId },
            include: [{ model: db.User, attributes: ['id', 'username', 'email', 'studentId'] }],
            order: [['timestamp', 'DESC']]
        });

        const lateThreshold = session.Event.startTime
            ? new Date(new Date(session.Event.startTime).getTime() + 5 * 60000)
            : null;

        const memberMap = new Map();
        const toMillis = (value) => {
            if (!value) return 0;
            const date = new Date(value);
            return Number.isNaN(date.getTime()) ? 0 : date.getTime();
        };
        const isNewer = (nextTime, currentTime) => {
            if (!currentTime) return !!nextTime;
            if (!nextTime) return false;
            return new Date(nextTime) > new Date(currentTime);
        };

        records.forEach((r) => {
            const member = r.Member || {};
            const checkedInAt = r.checkedInAt || null;
            if (!member.id) return;
            const existing = memberMap.get(member.id);
            if (!existing || isNewer(checkedInAt, existing.checkedInAt)) {
                memberMap.set(member.id, {
                    id: member.id,
                    username: member.username,
                    email: member.email,
                    studentId: member.studentId,
                    checkedInAt,
                    isLate: lateThreshold && checkedInAt ? new Date(checkedInAt) > lateThreshold : false
                });
            }
        });

        manualAttendances.forEach((a) => {
            const member = a.User || {};
            const checkedInAt = a.timestamp || null;
            if (!member.id) return;
            const existing = memberMap.get(member.id);
            if (!existing || isNewer(checkedInAt, existing.checkedInAt)) {
                memberMap.set(member.id, {
                    id: member.id,
                    username: member.username,
                    email: member.email,
                    studentId: member.studentId,
                    checkedInAt,
                    isLate: lateThreshold && checkedInAt ? new Date(checkedInAt) > lateThreshold : false
                });
            }
        });

        const members = Array.from(memberMap.values()).sort((a, b) => toMillis(b.checkedInAt) - toMillis(a.checkedInAt));
        const lateCount = lateThreshold ? members.filter(m => m.checkedInAt && new Date(m.checkedInAt) > lateThreshold).length : 0;

        const timeLeft = Math.max(0, Math.floor((new Date(session.expiresAt) - new Date()) / 1000));

        res.json({
            success: true,
            summary: {
                sessionId: session.id,
                eventId: session.eventId,
                eventTitle: session.Event?.title || 'Unknown Event',
                status: session.status,
                presentCount: members.length,
                lateCount,
                timeLeft,
                expiresAt: session.expiresAt,
                members
            }
        });
    } catch (error) {
        console.error('Error fetching attendance summary:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// End attendance session (Owner)
app.post('/attendance/session/:id/end', verifyToken, isOwner, async (req, res) => {
    try {
        const sessionId = parseInt(req.params.id);

        const session = await db.AttendanceSession.findByPk(sessionId);

        if (!session) {
            return res.status(404).json({ success: false, message: 'Session not found!' });
        }

        if (session.ownerId !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Access denied!' });
        }

        if (session.status === 'closed') {
            return res.json({ success: true, message: 'Session already closed!' });
        }

        session.status = 'closed';
        await session.save();

        // Get final count
        const count = await db.AttendanceRecord.count({ where: { sessionId: session.id } });

        console.log(`🛑 [QR] Attendance session ended. Total present: ${count}`);

        res.json({
            success: true,
            message: 'Attendance session ended!',
            totalPresent: count
        });
    } catch (error) {
        console.error('Error ending session:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// ========== MEMBER ROLES MANAGEMENT ==========

app.post('/owner/assign-role', verifyToken, isOwner, async (req, res) => {
    return res.status(501).json({
        success: false,
        message: 'Club roles are not implemented in the SQL-only version.'
    });
});

// ========== MEMBER SEARCH ==========

app.get('/owner/search-members', verifyToken, isAdminOrModerator, async (req, res) => {
    try {
        const query = String(req.query.query || '').trim();

        if (!query || query.length < 2) {
            return res.status(400).json({
                success: false,
                message: 'Search query must be at least 2 characters!'
            });
        }

        const user = await db.findUserById(req.user.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found!' });
        }

        let club;
        if (user.role === 'owner') {
            club = await db.findClubByOwnerId(user.id);
        } else {
            const memberships = await db.getUserClubs(user.id);
            if (!memberships || memberships.length === 0) {
                return res.status(404).json({ success: false, message: 'Club not found!' });
            }
            club = await db.findClubById(memberships[0].id);
        }

        if (!club) {
            return res.status(404).json({ success: false, message: 'Club not found!' });
        }

        const searchTerm = query.toLowerCase();
        const clubMembers = await db.getClubMembers(club.id);

        const filtered = clubMembers.filter(m =>
            (m.username || '').toLowerCase().includes(searchTerm) ||
            (m.email || '').toLowerCase().includes(searchTerm) ||
            (m.studentId || '').toLowerCase().includes(searchTerm)
        );

        const memberData = filtered.map(m => ({
            id: m.id,
            username: m.username,
            email: m.email,
            studentId: m.studentId,
            points: m.points || 0,
            rank: m.rank || 'Rookie',
            clubRole: m.clubRole || 'member',
            profilePic: m.profile?.pic || ''
        }));

        res.json({ success: true, members: memberData });
    } catch (error) {
        console.error('Error searching members:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// ========== MESSAGING SYSTEM ==========

// Get contacts list (Owner-Only Messaging)
app.get('/messages/contacts', verifyToken, async (req, res) => {
    try {
        const currentUser = await db.findUserById(req.user.id);
        if (!currentUser) {
            return res.status(404).json({ success: false, message: 'User not found!' });
        }

        const contacts = [];

        if (currentUser.role === 'member') {
            const memberships = await db.getUserClubs(currentUser.id);
            if (!memberships || memberships.length === 0) {
                return res.json({ success: true, contacts: [] });
            }

            const club = await db.findClubById(memberships[0].id);
            const ownerId = club?.Owner?.id || club?.ownerId;
            if (!ownerId) {
                return res.json({ success: true, contacts: [] });
            }

            const owner = await db.findUserById(ownerId);
            if (!owner) {
                return res.json({ success: true, contacts: [] });
            }

            const lastMessage = await db.Message.findOne({
                where: {
                    [Op.or]: [
                        { senderId: currentUser.id, recipientId: owner.id, type: 'direct' },
                        { senderId: owner.id, recipientId: currentUser.id, type: 'direct' }
                    ]
                },
                order: [['createdAt', 'DESC']]
            });

            const unreadCount = await db.Message.count({
                where: { senderId: owner.id, recipientId: currentUser.id, type: 'direct', isRead: false }
            });

            contacts.push({
                id: owner.id,
                username: owner.username,
                email: owner.email,
                role: owner.role,
                clubName: club?.name || '',
                lastMessage: lastMessage ? lastMessage.toJSON() : null,
                unreadCount
            });
        } else if (currentUser.role === 'owner') {
            const ownerClub = await db.findClubByOwnerId(currentUser.id);
            if (!ownerClub) {
                return res.json({ success: true, contacts: [] });
            }

            const clubMembers = await db.getClubMembers(ownerClub.id);
            for (const member of clubMembers) {
                const lastMessage = await db.Message.findOne({
                    where: {
                        [Op.or]: [
                            { senderId: currentUser.id, recipientId: member.id, type: 'direct' },
                            { senderId: member.id, recipientId: currentUser.id, type: 'direct' }
                        ]
                    },
                    order: [['createdAt', 'DESC']]
                });

                const unreadCount = await db.Message.count({
                    where: { senderId: member.id, recipientId: currentUser.id, type: 'direct', isRead: false }
                });

                contacts.push({
                    id: member.id,
                    username: member.username,
                    email: member.email,
                    studentId: member.studentId,
                    role: 'member',
                    lastMessage: lastMessage ? lastMessage.toJSON() : null,
                    unreadCount
                });
            }
        }

        res.json({ success: true, contacts });
    } catch (error) {
        console.error('Error fetching contacts:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.get('/messages', verifyToken, async (req, res) => {
    try {
        const recipientId = req.query.recipientId ? parseInt(req.query.recipientId) : null;
        const clubId = req.query.clubId ? parseInt(req.query.clubId) : null;

        let where;
        if (recipientId) {
            where = {
                [Op.or]: [
                    { senderId: req.user.id, recipientId, type: 'direct' },
                    { senderId: recipientId, recipientId: req.user.id, type: 'direct' }
                ]
            };
        } else if (clubId) {
            where = { clubId, type: 'club' };
        } else {
            where = {
                [Op.or]: [
                    { senderId: req.user.id },
                    { recipientId: req.user.id }
                ]
            };
        }

        const messages = await db.Message.findAll({
            where,
            include: [
                { model: db.User, as: 'Sender', attributes: ['id', 'username', 'role'] },
                { model: db.User, as: 'Recipient', attributes: ['id', 'username', 'role'] }
            ],
            order: [['createdAt', 'ASC']]
        });

        // Backward-compatible shape (read vs isRead, senderName/Role)
        const result = messages.map(m => ({
            ...m.toJSON(),
            senderName: m.Sender?.username || 'Unknown',
            senderRole: m.Sender?.role || 'member',
            read: !!m.isRead
        }));

        res.json({ success: true, messages: result });
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.post('/messages', verifyToken, async (req, res) => {
    try {
        const { recipientId, clubId, message, type = 'direct' } = req.body;

        if (!message || message.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Message cannot be empty!'
            });
        }

        if (type === 'direct' && !recipientId) {
            return res.status(400).json({
                success: false,
                message: 'Recipient ID required for direct messages!'
            });
        }

        // Use SQL database to find sender
        const sender = await db.findUserById(req.user.id);

        if (!sender) {
            return res.status(404).json({
                success: false,
                message: 'Sender not found!'
            });
        }

        // ========== OWNER-ONLY MESSAGING RULES ==========
        // Rule 1: Owner can message any member in their club
        // Rule 2: Members can ONLY message their club owner

        const parsedRecipientId = recipientId ? parseInt(recipientId) : null;
        const parsedClubId = clubId ? parseInt(clubId) : null;

        if (sender.role === 'member') {
            // Member trying to send a message - get their clubs from SQL
            const memberClubs = await db.getUserClubs(sender.id);

            if (!memberClubs || memberClubs.length === 0) {
                return res.status(403).json({
                    success: false,
                    message: 'You must be part of a club to send messages!'
                });
            }

            // Use first club
            const activeClub = await db.findClubById(memberClubs[0].id);

            if (!activeClub) {
                return res.status(403).json({
                    success: false,
                    message: 'Your club not found!'
                });
            }

            // Find owner from club
            const ownerIds = new Set(
                [
                    activeClub.ownerId,
                    ...(activeClub.Owners || []).map(o => o.id)
                ].filter(Boolean)
            );

            if (!parsedRecipientId || !ownerIds.has(parsedRecipientId)) {
                return res.status(403).json({
                    success: false,
                    message: '🔒 You can only message your club owner!'
                });
            }
        } else if (sender.role === 'owner') {
            // Owner trying to send a message - find their club from SQL
            const ownerClub = await db.findClubByOwnerId(sender.id);

            if (!ownerClub) {
                return res.status(403).json({
                    success: false,
                    message: 'Your club not found!'
                });
            }

            // Check if recipient exists using SQL
            if (!parsedRecipientId) {
                return res.status(400).json({
                    success: false,
                    message: 'Recipient ID required for direct messages!'
                });
            }

            const recipient = await db.findUserById(parsedRecipientId);

            if (!recipient) {
                return res.status(404).json({
                    success: false,
                    message: 'Recipient not found!'
                });
            }

            if (recipient.role === 'member') {
                // Check if recipient is a member of owner's club using SQL
                const membership = await db.getMembership(parsedRecipientId, ownerClub.id);

                if (!membership) {
                    return res.status(403).json({
                        success: false,
                        message: '🔒 You can only message members of your club!'
                    });
                }
            } else {
                return res.status(403).json({
                    success: false,
                    message: '🔒 You can only message members!'
                });
            }
        } else {
            return res.status(403).json({
                success: false,
                message: 'Invalid user role for messaging!'
            });
        }

        // If we reach here, the message is allowed
        const created = await db.Message.create({
            senderId: sender.id,
            recipientId: type === 'direct' ? parsedRecipientId : null,
            clubId: type === 'club' ? parsedClubId : null,
            type,
            message: message.trim(),
            isRead: false,
            createdAt: new Date()
        });

        const messagePayload = {
            ...created.toJSON(),
            senderName: sender.username || 'Unknown',
            senderRole: sender.role,
            read: false
        };

        // Send notification to recipient (direct only)
        if (type === 'direct' && parsedRecipientId) {
            await createSqlNotification(parsedRecipientId, {
                type: 'system',
                title: 'New Message',
                message: `You have a new message from ${sender.username}`
            });

            // Emit real-time message
            io.to(`user-${parsedRecipientId}`).emit('new-message', messagePayload);
        }

        io.to(`user-${req.user.id}`).emit('message-sent', messagePayload);

        res.json({
            success: true,
            message: 'Message sent successfully!',
            messageData: messagePayload
        });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.put('/messages/:id/read', verifyToken, async (req, res) => {
    try {
        const messageId = parseInt(req.params.id);
        const msg = await db.Message.findByPk(messageId);

        if (!msg) {
            return res.status(404).json({ success: false, message: 'Message not found!' });
        }

        if (msg.recipientId !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Access denied!' });
        }

        await msg.update({ isRead: true, readAt: new Date() });

        res.json({ success: true, message: 'Message marked as read!' });
    } catch (error) {
        console.error('Error marking message as read:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// ========== NOTIFICATIONS API ==========

app.get('/notifications', verifyToken, async (req, res) => {
    try {
        const notifications = await db.Notification.findAll({
            where: { userId: req.user.id },
            order: [['createdAt', 'DESC']],
            limit: 50
        });

        const unreadCount = await db.Notification.count({
            where: { userId: req.user.id, isRead: false }
        });

        res.json({
            success: true,
            notifications,
            unreadCount
        });
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.put('/notifications/:id/read', verifyToken, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const notification = await db.Notification.findOne({
            where: { id, userId: req.user.id }
        });

        if (!notification) {
            return res.status(404).json({ success: false, message: 'Notification not found!' });
        }

        await notification.update({ isRead: true });
        res.json({ success: true, message: 'Notification marked as read!' });
    } catch (error) {
        console.error('Error marking notification as read:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

app.put('/notifications/read-all', verifyToken, async (req, res) => {
    try {
        await db.Notification.update(
            { isRead: true },
            { where: { userId: req.user.id, isRead: false } }
        );

        res.json({ success: true, message: 'All notifications marked as read!' });
    } catch (error) {
        console.error('Error marking all notifications as read:', error);
        res.status(500).json({ success: false, message: 'Server error!' });
    }
});

// ========== MEMBER PROJECT MANAGEMENT ==========

// Get all active projects for a member (supports multiple projects)
app.get('/member/my-projects', verifyToken, isMember, async (req, res) => {
    try {
        const userId = req.user.id;

        const { clubs, activeClubId } = await resolveMemberClubContext(userId);
        if (!clubs || clubs.length === 0) {
            return res.json({ success: true, memberProjects: [] });
        }
        const clubId = activeClubId || clubs[0].id;

        // Get all active (non-archived) projects for this member
        const projects = await db.MemberProject.findAll({
            where: {
                userId,
                clubId,
                isArchived: false
            },
            order: [['createdAt', 'DESC']]
        });

        res.json({
            success: true,
            memberProjects: projects
        });
    } catch (error) {
        console.error('Error fetching member projects:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch projects'
        });
    }
});

// Get available project ideas
app.get('/member/project-ideas', verifyToken, isMember, async (req, res) => {
    try {
        const userId = req.user.id;

        const { clubs, activeClubId } = await resolveMemberClubContext(userId);
        if (!clubs || clubs.length === 0) {
            return res.json({ success: true, projectIdeas: [] });
        }
        const clubId = activeClubId || clubs[0].id;

        // Get all project ideas for this club
        const ideas = await db.ProjectIdea.findAll({
            where: { clubId },
            order: [['createdAt', 'DESC']]
        });

        res.json({
            success: true,
            projectIdeas: ideas
        });
    } catch (error) {
        console.error('Error fetching project ideas:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch project ideas'
        });
    }
});

// Choose/Add a new project (max 3 projects)
app.post('/member/choose-project', verifyToken, isMember, async (req, res) => {
    try {
        const userId = req.user.id;
        const rawId = req.body.projectIdeaId;
        const projectIdeaId = rawId != null ? parseInt(String(rawId), 10) : NaN;

        if (!projectIdeaId || isNaN(projectIdeaId)) {
            return res.status(400).json({
                success: false,
                message: 'Project idea ID is required'
            });
        }

        // Use same club resolution as rest of app (first club from getUserClubs)
        const { clubs, activeClubId } = await resolveMemberClubContext(userId);
        if (!clubs || clubs.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'You are not a member of any club'
            });
        }
        const clubId = activeClubId || clubs[0].id;

        // Check how many active projects the user already has
        const activeProjectsCount = await db.MemberProject.count({
            where: {
                userId,
                clubId,
                isArchived: false
            }
        });

        if (activeProjectsCount >= 3) {
            return res.status(400).json({
                success: false,
                message: 'You can only have 3 active projects. Please remove one first.'
            });
        }

        // Check if already selected this project
        const existingProject = await db.MemberProject.findOne({
            where: {
                userId,
                clubId,
                projectIdeaId,
                isArchived: false
            }
        });

        if (existingProject) {
            return res.status(400).json({
                success: false,
                message: 'You have already selected this project'
            });
        }

        // Get project idea details
        const projectIdea = await db.ProjectIdea.findByPk(projectIdeaId);

        if (!projectIdea || projectIdea.clubId !== clubId) {
            return res.status(404).json({
                success: false,
                message: 'Project idea not found'
            });
        }

        // Create new member project
        const newProject = await db.MemberProject.create({
            userId,
            clubId,
            projectIdeaId,
            projectTitleSnapshot: projectIdea.title,
            projectDescriptionSnapshot: projectIdea.description || null,
            status: 'not_started',
            progressPercent: 0,
            startedAt: new Date()
        });

        res.json({
            success: true,
            message: 'Project added successfully!',
            project: newProject
        });
    } catch (error) {
        console.error('Error choosing project:', error);
        console.error(error.stack);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to add project'
        });
    }
});

// Update project progress
app.put('/member/update-project/:projectId', verifyToken, isMember, async (req, res) => {
    try {
        const userId = req.user.id;
        const projectId = parseInt(req.params.projectId);
        const { status, progressPercent } = req.body;

        // Find the project
        const project = await db.MemberProject.findOne({
            where: {
                id: projectId,
                userId,
                isArchived: false
            }
        });

        if (!project) {
            return res.status(404).json({
                success: false,
                message: 'Project not found'
            });
        }

        // Prepare updates
        const updates = {
            lastUpdatedAt: new Date()
        };

        if (status !== undefined) {
            updates.status = status;

            // If status is completed, set completedAt and approvalStatus
            if (status === 'completed' && project.status !== 'completed') {
                updates.completedAt = new Date();
                updates.approvalStatus = 'pending';
            }
        }

        if (progressPercent !== undefined) {
            updates.progressPercent = progressPercent;
        }

        // Update the project
        await project.update(updates);

        // Log history
        await db.MemberProjectHistory.create({
            memberProjectId: project.id,
            userId,
            action: 'progress_update',
            oldStatus: project.status,
            newStatus: updates.status || project.status,
            oldProgress: project.progressPercent,
            newProgress: updates.progressPercent !== undefined ? updates.progressPercent : project.progressPercent,
            notes: `Updated by member`
        });

        res.json({
            success: true,
            message: 'Project updated successfully!',
            project: await db.MemberProject.findByPk(projectId)
        });
    } catch (error) {
        console.error('Error updating project:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update project'
        });
    }
});

// Remove/Archive a project
app.delete('/member/remove-project/:projectId', verifyToken, isMember, async (req, res) => {
    try {
        const userId = req.user.id;
        const projectId = parseInt(req.params.projectId);

        // Find the project
        const project = await db.MemberProject.findOne({
            where: {
                id: projectId,
                userId,
                isArchived: false
            }
        });

        if (!project) {
            return res.status(404).json({
                success: false,
                message: 'Project not found'
            });
        }

        // Archive the project (soft delete - keeps progress)
        await project.update({
            isArchived: true,
            lastUpdatedAt: new Date()
        });

        // Log history
        await db.MemberProjectHistory.create({
            memberProjectId: project.id,
            userId,
            action: 'removed',
            oldStatus: project.status,
            newStatus: project.status,
            oldProgress: project.progressPercent,
            newProgress: project.progressPercent,
            notes: 'Project removed by member'
        });

        res.json({
            success: true,
            message: 'Project removed successfully!'
        });
    } catch (error) {
        console.error('Error removing project:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to remove project'
        });
    }
});

// ========== ADMIN/DEBUG ENDPOINTS - DATA VALIDATION ==========

// Validate and sync data (Admin only - for debugging)
app.post('/admin/validate-data', verifyToken, async (req, res) => {
    const user = await db.findUserById(req.user.id);
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Access denied!' });
    }
    return res.status(501).json({ success: false, message: 'Not available in SQL-only version.' });
});

// Get system statistics (Admin only)
app.get('/admin/system-stats', verifyToken, async (req, res) => {
    const user = await db.findUserById(req.user.id);
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Access denied!' });
    }
    return res.status(501).json({ success: false, message: 'Not available in SQL-only version.' });
});

// Start server
const PORT = process.env.PORT || 4000;

// Connect to PostgreSQL and start server.
// Schema creation/updates are handled via dedicated migration scripts (see package.json db:* scripts).
db.sequelize.authenticate()
    .then(async () => {
        console.log('✅ Database connected (PostgreSQL)');
    })
    .then(async () => {
        await ensureActiveClubColumn();
    })
    .then(async () => {
        await ensureAdminUser();
    })
    .then(() => {

        server.listen(PORT, () => {
            console.log(`🚀 Server running on http://localhost:${PORT}`);
            console.log(`📡 Socket.IO server ready`);
        });
    })
    .catch(err => {
        console.error('❌ Database connection failed:', err);
    });
