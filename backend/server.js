const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const multer = require('multer');
const { Server } = require('socket.io');
const http = require('http');
require('dotenv').config();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

// ========== SQL DATABASE SERVICE ==========
const db = require('./utils/dbService');
const { generateNonce, generateAttendanceToken, verifyAttendanceToken, generateAttendanceCode } = require('./utils/tokenUtils');

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';

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

// ========== ROUTES ==========

// Test route
app.get('/', (req, res) => {
    res.json({ message: 'Server is running! 🚀' });
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

        // Validation
        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: 'Username and password are required!'
            });
        }

        // Find user in SQL database (case-insensitive)
        const user = await db.findUserByUsername(username);

        if (!user) {
            console.log(`❌ Login failed: User "${username}" not found`);
            return res.status(401).json({
                success: false,
                message: 'Invalid username or password!'
            });
        }

        // Check if password field exists
        if (!user.password) {
            console.log(`❌ Login failed: User "${username}" has no password set`);
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
                    console.log(`🔐 [SQL] Upgraded password for user "${username}" to hashed storage`);
                } catch (upgradeErr) {
                    console.error('Error upgrading legacy password hash:', upgradeErr);
                }
            }
        }

        if (!passwordValid) {
            console.log(`❌ Login failed: Password mismatch for user "${username}"`);
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

        // Generate QR code
        const qrData = JSON.stringify({ clubId: ownerClub.id, title, date });
        const qrCode = await QRCode.toDataURL(qrData);

        // Create event using SQL
        const newEvent = await db.createEvent({
            title,
            date,
            venue,
            description: description || '',
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

        const newAnnouncement = await db.Announcement.create({
            clubId: ownerClub.id,
            title: title || 'Announcement',
            message,
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
        const poll = await db.createPoll(ownerClub.id, req.user.id, question, options, endDate || null);
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
        const idea = await db.createProjectIdea(ownerClub.id, { title, description });
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

// Get member dashboard - NOW USING SQL DATABASE
app.get('/member/dashboard', verifyToken, isMember, async (req, res) => {
    try {
        // Find member using SQL
        const member = await db.findUserById(req.user.id);
        if (!member) {
            return res.status(404).json({ success: false, message: 'Member not found!' });
        }

        // Get member's clubs using SQL
        const memberClubs = await db.getUserClubs(req.user.id);

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

        // Get first/active club (simplified)
        const activeClub = memberClubs[0];
        const club = await db.findClubById(activeClub.id);

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
        // Get member's clubs using SQL
        const memberClubs = await db.getUserClubs(req.user.id);

        // Handle case when member has no club
        if (!memberClubs || memberClubs.length === 0) {
            return res.json({ success: true, events: [] });
        }

        // Get active club events using SQL
        const activeClub = memberClubs[0];
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
        // Get member's clubs using SQL
        const memberClubs = await db.getUserClubs(req.user.id);

        if (!memberClubs || memberClubs.length === 0) {
            // No club - return empty leaderboard
            return res.json({ success: true, leaderboard: [] });
        }

        // Get active club
        const activeClub = memberClubs[0];

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
        const announcements = await db.getAnnouncementsForUser(req.user.id);

        console.log(`📢 [SQL] Fetched ${announcements.length} announcements for member`);

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
        const clubs = await db.getUserClubs(req.user.id);
        if (!clubs || clubs.length === 0) return res.json({ success: true, projectIdeas: [] });
        const targetClubId = clubId || clubs[0].id;
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
        const clubs = await db.getUserClubs(req.user.id);
        if (!clubs || clubs.length === 0) return res.json({ success: true, memberProject: null });
        const targetClubId = clubId || clubs[0].id;
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
        const clubs = await db.getUserClubs(req.user.id);
        if (!clubs || clubs.length === 0) return res.status(400).json({ success: false, message: 'Not in any club!' });
        const clubId = req.body.clubId ? parseInt(req.body.clubId, 10) : clubs[0].id;
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
        // Find member using SQL
        const member = await db.findUserById(req.user.id);
        if (!member) {
            return res.status(404).json({ success: false, message: 'Member not found!' });
        }

        // Get member's clubs using SQL
        const memberClubs = await db.getUserClubs(req.user.id);

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

        // Get active club (first club)
        if (memberClubs.length > 0) {
            activeClubPoints = memberClubs[0].points || 0;
            activeClubRank = memberClubs[0].rank || 'Rookie';
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
        // Find member using SQL
        const member = await db.findUserById(req.user.id);
        if (!member) {
            return res.status(404).json({ success: false, message: 'Member not found!' });
        }

        // Get member's clubs using SQL
        const memberClubs = await db.getUserClubs(req.user.id);

        console.log(`📋 [SQL] Fetched ${memberClubs.length} clubs for member: ${member.username}`);

        res.json({
            success: true,
            clubs: memberClubs.map(c => ({
                id: c.id,
                name: c.name,
                logo: c.logo,
                tagline: c.tagline,
                isActive: false // 'activeClub' concept is simplified in SQL for now
            })),
            activeClub: memberClubs.length > 0 ? memberClubs[0].id : null
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

        // In SQL version, we don't persist activeClub yet. 
        // This is a placeholder to keep frontend happy.
        console.log(`🔄 [SQL] Switch club requested to ID: ${clubId} (Not persisted)`);

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

// ========== SOCKET.IO SETUP ==========

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join-club', (clubId) => {
        socket.join(`club-${clubId}`);
        console.log(`Socket ${socket.id} joined club-${clubId}`);
    });

    socket.on('join-user', (userId) => {
        socket.join(`user-${userId}`);
        console.log(`Socket ${socket.id} joined user-${userId}`);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
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
        const { eventId, expiryMinutes = 3 } = req.body;

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

        // Get attendance records with member details
        const records = await db.AttendanceRecord.findAll({
            where: { sessionId: session.id },
            include: [{ model: db.User, as: 'Member', attributes: ['id', 'username', 'email', 'studentId'] }],
            order: [['checkedInAt', 'DESC']]
        });

        // Calculate late count
        let lateCount = 0;
        if (session.Event.startTime) {
            const lateThreshold = new Date(session.Event.startTime);
            lateThreshold.setMinutes(lateThreshold.getMinutes() + 5);
            lateCount = records.filter(r => new Date(r.checkedInAt) > lateThreshold).length;
        }

        const timeLeft = Math.max(0, Math.floor((new Date(session.expiresAt) - new Date()) / 1000));

        res.json({
            success: true,
            summary: {
                sessionId: session.id,
                eventId: session.eventId,
                eventTitle: session.Event?.title || 'Unknown Event',
                status: session.status,
                presentCount: records.length,
                lateCount,
                timeLeft,
                expiresAt: session.expiresAt,
                members: records.map(r => ({
                    id: r.Member?.id,
                    username: r.Member?.username,
                    studentId: r.Member?.studentId,
                    checkedInAt: r.checkedInAt,
                    isLate: session.Event.startTime ?
                        new Date(r.checkedInAt) > new Date(new Date(session.Event.startTime).getTime() + 5 * 60000) : false
                }))
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
            const owner = await db.findUserById(activeClub.ownerId);

            if (!owner) {
                return res.status(403).json({
                    success: false,
                    message: 'Club owner not found!'
                });
            }

            // Check if member is trying to message the owner
            if (!parsedRecipientId || parsedRecipientId !== owner.id) {
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

        const clubs = await db.getUserClubs(userId);
        if (!clubs || clubs.length === 0) {
            return res.json({ success: true, memberProjects: [] });
        }
        const clubId = clubs[0].id;

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

        const clubs = await db.getUserClubs(userId);
        if (!clubs || clubs.length === 0) {
            return res.json({ success: true, projectIdeas: [] });
        }
        const clubId = clubs[0].id;

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
        const clubs = await db.getUserClubs(userId);
        if (!clubs || clubs.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'You are not a member of any club'
            });
        }
        const clubId = clubs[0].id;

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

// Ensure SQLite enforces foreign keys, then start server.
// Schema creation/updates are handled via dedicated migration scripts (see package.json db:* scripts).
db.sequelize.authenticate()
    .then(async () => {
        if (db.sequelize.getDialect() === 'sqlite') {
            await db.sequelize.query('PRAGMA foreign_keys = ON;');
            console.log('✅ Database connected (foreign keys ON)');
        } else {
            console.log('✅ Database connected');
        }
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
