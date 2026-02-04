const sequelize = require('../config/database');
const User = require('./User');
const Club = require('./Club');
const Event = require('./Event');
const Membership = require('./Membership');
const Message = require('./Message');
const GalleryPhoto = require('./GalleryPhoto');
const MemberCertificate = require('./MemberCertificate');
const Poll = require('./Poll');
const PollOption = require('./PollOption');
const PollVote = require('./PollVote');
const ProjectIdea = require('./ProjectIdea');
const MemberProject = require('./MemberProject');
const MemberProjectHistory = require('./MemberProjectHistory');
const AttendanceSession = require('./AttendanceSession');
const AttendanceRecord = require('./AttendanceRecord');
const ClubOwner = require('./ClubOwner');

// ========== RELATIONSHIPS ==========

Club.belongsTo(User, { as: 'Owner', foreignKey: 'ownerId' });
User.hasOne(Club, { as: 'OwnedClub', foreignKey: 'ownerId' });
Club.belongsToMany(User, { through: ClubOwner, as: 'Owners', foreignKey: 'clubId', otherKey: 'userId' });
User.belongsToMany(Club, { through: ClubOwner, as: 'OwnedClubs', foreignKey: 'userId', otherKey: 'clubId' });

// Membership (User <-> Club) - Many to Many with CASCADE
User.belongsToMany(Club, { through: Membership, foreignKey: 'userId', otherKey: 'clubId' });
Club.belongsToMany(User, { through: Membership, foreignKey: 'clubId', otherKey: 'userId' });

// Direct associations for Membership (needed for includes)
Membership.belongsTo(User, { foreignKey: 'userId', onDelete: 'CASCADE' });
Membership.belongsTo(Club, { foreignKey: 'clubId', onDelete: 'CASCADE' });
User.hasMany(Membership, { foreignKey: 'userId', onDelete: 'CASCADE' });
Club.hasMany(Membership, { foreignKey: 'clubId', onDelete: 'CASCADE' });

// Events - CASCADE: Delete events when club is deleted
Club.hasMany(Event, { foreignKey: 'clubId', onDelete: 'CASCADE' });
Event.belongsTo(Club, { foreignKey: 'clubId', onDelete: 'CASCADE' });

// Announcements
const Announcement = require('./Announcement');
Club.hasMany(Announcement, { foreignKey: 'clubId', onDelete: 'CASCADE' });
Announcement.belongsTo(Club, { foreignKey: 'clubId', onDelete: 'CASCADE' });

// Announcement Creator Relationship (NEW)
Announcement.belongsTo(User, { as: 'Creator', foreignKey: 'createdById' });
User.hasMany(Announcement, { as: 'CreatedAnnouncements', foreignKey: 'createdById' });

// Attendance - CASCADE: Delete attendance when event is deleted
const Attendance = require('./Attendance');
Event.hasMany(Attendance, { foreignKey: 'eventId', onDelete: 'CASCADE' });
Attendance.belongsTo(Event, { foreignKey: 'eventId', onDelete: 'CASCADE' });
User.hasMany(Attendance, { foreignKey: 'userId', onDelete: 'CASCADE' });
Attendance.belongsTo(User, { foreignKey: 'userId', onDelete: 'CASCADE' });

// Event RSVPs - CASCADE: Delete RSVPs when event is deleted
const EventRSVP = require('./EventRSVP');
Event.hasMany(EventRSVP, { foreignKey: 'eventId', onDelete: 'CASCADE' });
EventRSVP.belongsTo(Event, { foreignKey: 'eventId', onDelete: 'CASCADE' });
User.hasMany(EventRSVP, { foreignKey: 'userId', onDelete: 'CASCADE' });
EventRSVP.belongsTo(User, { foreignKey: 'userId', onDelete: 'CASCADE' });

// Point History - CASCADE on user/club delete
const PointHistory = require('./PointHistory');
User.hasMany(PointHistory, { foreignKey: 'userId', onDelete: 'CASCADE' });
PointHistory.belongsTo(User, { foreignKey: 'userId', onDelete: 'CASCADE' });
Club.hasMany(PointHistory, { foreignKey: 'clubId', onDelete: 'CASCADE' });
PointHistory.belongsTo(Club, { foreignKey: 'clubId', onDelete: 'CASCADE' });

// Notifications - CASCADE: Delete notifications when user is deleted
const Notification = require('./Notification');
User.hasMany(Notification, { foreignKey: 'userId', onDelete: 'CASCADE' });
Notification.belongsTo(User, { foreignKey: 'userId', onDelete: 'CASCADE' });

User.hasMany(Message, { as: 'SentMessages', foreignKey: 'senderId', onDelete: 'CASCADE' });
User.hasMany(Message, { as: 'ReceivedMessages', foreignKey: 'recipientId', onDelete: 'CASCADE' });
Message.belongsTo(User, { as: 'Sender', foreignKey: 'senderId', onDelete: 'CASCADE' });
Message.belongsTo(User, { as: 'Recipient', foreignKey: 'recipientId', onDelete: 'CASCADE' });

Event.hasMany(GalleryPhoto, { foreignKey: 'eventId', onDelete: 'CASCADE' });
GalleryPhoto.belongsTo(Event, { foreignKey: 'eventId', onDelete: 'CASCADE' });

User.hasMany(MemberCertificate, { foreignKey: 'memberId', onDelete: 'CASCADE' });
MemberCertificate.belongsTo(User, { foreignKey: 'memberId', onDelete: 'CASCADE' });
Club.hasMany(MemberCertificate, { foreignKey: 'clubId', onDelete: 'CASCADE' });
MemberCertificate.belongsTo(Club, { foreignKey: 'clubId', onDelete: 'CASCADE' });
Event.hasMany(MemberCertificate, { foreignKey: 'eventId', onDelete: 'SET NULL' });
MemberCertificate.belongsTo(Event, { foreignKey: 'eventId', onDelete: 'SET NULL' });

// Polls - Club polls created by owner, members vote
Club.hasMany(Poll, { foreignKey: 'clubId', onDelete: 'CASCADE' });
Poll.belongsTo(Club, { foreignKey: 'clubId', onDelete: 'CASCADE' });
User.hasMany(Poll, { as: 'CreatedPolls', foreignKey: 'createdById', onDelete: 'CASCADE' });
Poll.belongsTo(User, { as: 'Creator', foreignKey: 'createdById', onDelete: 'CASCADE' });

Poll.hasMany(PollOption, { as: 'Options', foreignKey: 'pollId', onDelete: 'CASCADE' });
PollOption.belongsTo(Poll, { foreignKey: 'pollId', onDelete: 'CASCADE' });

Poll.hasMany(PollVote, { foreignKey: 'pollId', onDelete: 'CASCADE' });
PollVote.belongsTo(Poll, { foreignKey: 'pollId', onDelete: 'CASCADE' });
PollOption.hasMany(PollVote, { foreignKey: 'optionId', onDelete: 'CASCADE' });
PollVote.belongsTo(PollOption, { foreignKey: 'optionId', onDelete: 'CASCADE' });
User.hasMany(PollVote, { foreignKey: 'userId', onDelete: 'CASCADE' });
PollVote.belongsTo(User, { foreignKey: 'userId', onDelete: 'CASCADE' });

// Project ideas and member projects
Club.hasMany(ProjectIdea, { foreignKey: 'clubId', onDelete: 'CASCADE' });
ProjectIdea.belongsTo(Club, { foreignKey: 'clubId', onDelete: 'CASCADE' });

Club.hasMany(MemberProject, { foreignKey: 'clubId', onDelete: 'CASCADE' });
MemberProject.belongsTo(Club, { foreignKey: 'clubId', onDelete: 'CASCADE' });
User.hasMany(MemberProject, { foreignKey: 'userId', onDelete: 'CASCADE' });
MemberProject.belongsTo(User, { foreignKey: 'userId', onDelete: 'CASCADE' });
ProjectIdea.hasMany(MemberProject, { foreignKey: 'projectIdeaId', onDelete: 'SET NULL' });
MemberProject.belongsTo(ProjectIdea, { foreignKey: 'projectIdeaId', onDelete: 'SET NULL' });

MemberProject.hasMany(MemberProjectHistory, { foreignKey: 'memberProjectId', onDelete: 'CASCADE' });
MemberProjectHistory.belongsTo(MemberProject, { foreignKey: 'memberProjectId', onDelete: 'CASCADE' });

// Attendance Sessions - QR-based attendance
Event.hasMany(AttendanceSession, { foreignKey: 'eventId', onDelete: 'CASCADE' });
AttendanceSession.belongsTo(Event, { foreignKey: 'eventId', onDelete: 'CASCADE' });
User.hasMany(AttendanceSession, { as: 'OwnedSessions', foreignKey: 'ownerId', onDelete: 'CASCADE' });
AttendanceSession.belongsTo(User, { as: 'Owner', foreignKey: 'ownerId', onDelete: 'CASCADE' });

// Attendance Records
AttendanceSession.hasMany(AttendanceRecord, { foreignKey: 'sessionId', onDelete: 'CASCADE' });
AttendanceRecord.belongsTo(AttendanceSession, { foreignKey: 'sessionId', onDelete: 'CASCADE' });
Event.hasMany(AttendanceRecord, { foreignKey: 'eventId', onDelete: 'CASCADE' });
AttendanceRecord.belongsTo(Event, { foreignKey: 'eventId', onDelete: 'CASCADE' });
User.hasMany(AttendanceRecord, { as: 'AttendanceRecords', foreignKey: 'memberId', onDelete: 'CASCADE' });
AttendanceRecord.belongsTo(User, { as: 'Member', foreignKey: 'memberId', onDelete: 'CASCADE' });

module.exports = {
    sequelize,
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
    ClubOwner
};
