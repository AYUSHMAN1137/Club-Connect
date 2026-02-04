const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const db = require('../models');

const SQLITE_PATH = process.env.SQLITE_PATH || path.join(__dirname, '..', 'database.sqlite');

const TABLES = [
    { table: 'Users', model: db.User },
    { table: 'Clubs', model: db.Club },
    { table: 'Events', model: db.Event },
    { table: 'Memberships', model: db.Membership },
    { table: 'Announcements', model: db.Announcement },
    { table: 'Attendances', model: db.Attendance },
    { table: 'EventRSVPs', model: db.EventRSVP },
    { table: 'PointHistories', model: db.PointHistory },
    { table: 'Notifications', model: db.Notification },
    { table: 'Messages', model: db.Message },
    { table: 'GalleryPhotos', model: db.GalleryPhoto },
    { table: 'MemberCertificates', model: db.MemberCertificate },
    { table: 'Polls', model: db.Poll },
    { table: 'PollOptions', model: db.PollOption },
    { table: 'PollVotes', model: db.PollVote },
    { table: 'ProjectIdeas', model: db.ProjectIdea },
    { table: 'MemberProjects', model: db.MemberProject },
    { table: 'MemberProjectHistories', model: db.MemberProjectHistory },
    { table: 'AttendanceSessions', model: db.AttendanceSession },
    { table: 'AttendanceRecords', model: db.AttendanceRecord }
];

const FK_RULES = {
    Events: [{ field: 'clubId', model: db.Club }],
    Memberships: [
        { field: 'userId', model: db.User },
        { field: 'clubId', model: db.Club }
    ],
    Announcements: [
        { field: 'clubId', model: db.Club },
        { field: 'createdById', model: db.User, optional: true }
    ],
    Attendances: [
        { field: 'eventId', model: db.Event },
        { field: 'userId', model: db.User }
    ],
    EventRSVPs: [
        { field: 'eventId', model: db.Event },
        { field: 'userId', model: db.User }
    ],
    PointHistories: [
        { field: 'userId', model: db.User },
        { field: 'clubId', model: db.Club }
    ],
    Notifications: [{ field: 'userId', model: db.User }],
    Messages: [
        { field: 'senderId', model: db.User },
        { field: 'recipientId', model: db.User }
    ],
    GalleryPhotos: [{ field: 'eventId', model: db.Event }],
    MemberCertificates: [
        { field: 'memberId', model: db.User },
        { field: 'clubId', model: db.Club },
        { field: 'eventId', model: db.Event, optional: true }
    ],
    Polls: [
        { field: 'clubId', model: db.Club },
        { field: 'createdById', model: db.User }
    ],
    PollOptions: [{ field: 'pollId', model: db.Poll }],
    PollVotes: [
        { field: 'pollId', model: db.Poll },
        { field: 'optionId', model: db.PollOption },
        { field: 'userId', model: db.User }
    ],
    ProjectIdeas: [{ field: 'clubId', model: db.Club }],
    MemberProjects: [
        { field: 'clubId', model: db.Club },
        { field: 'userId', model: db.User },
        { field: 'projectIdeaId', model: db.ProjectIdea, optional: true }
    ],
    MemberProjectHistories: [{ field: 'memberProjectId', model: db.MemberProject }],
    AttendanceSessions: [
        { field: 'eventId', model: db.Event },
        { field: 'ownerId', model: db.User }
    ],
    AttendanceRecords: [
        { field: 'sessionId', model: db.AttendanceSession },
        { field: 'eventId', model: db.Event },
        { field: 'memberId', model: db.User }
    ]
};

function getTableNameForSequence(model) {
    const name = model.getTableName();
    if (typeof name === 'string') return name;
    return `${name.schema}.${name.tableName}`;
}

function pickFields(row, fields) {
    const picked = {};
    fields.forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(row, field)) {
            picked[field] = row[field];
        }
    });
    return picked;
}

function tableExists(sqlite, table) {
    return new Promise((resolve, reject) => {
        sqlite.get(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            [table],
            (err, row) => {
                if (err) return reject(err);
                resolve(Boolean(row));
            }
        );
    });
}

function fetchAll(sqlite, table) {
    return new Promise((resolve, reject) => {
        sqlite.all(`SELECT * FROM ${table}`, (err, rows) => {
            if (err) return reject(err);
            resolve(rows || []);
        });
    });
}

async function getExistingIds(model) {
    const rows = await model.findAll({ attributes: ['id'], raw: true });
    return new Set(rows.map((r) => String(r.id)));
}

async function filterByForeignKeys(tableName, rows) {
    const rules = FK_RULES[tableName];
    if (!rules || rows.length === 0) return rows;

    const idSets = new Map();
    for (const rule of rules) {
        const key = rule.model.name;
        if (!idSets.has(key)) {
            idSets.set(key, await getExistingIds(rule.model));
        }
    }

    return rows.filter((row) => {
        for (const rule of rules) {
            const value = row[rule.field];
            if (value === null || value === undefined || value === '') {
                if (rule.optional) continue;
                return false;
            }
            const set = idSets.get(rule.model.name);
            if (!set.has(String(value))) return false;
        }
        return true;
    });
}

async function resetSequence(model) {
    if (!model.rawAttributes.id || !model.rawAttributes.id.autoIncrement) return;
    const queryInterface = db.sequelize.getQueryInterface();
    const quotedTable = queryInterface.queryGenerator.quoteTable(model.getTableName());
    const seqTarget = db.sequelize.escape(quotedTable);
    await db.sequelize.query(
        `SELECT setval(pg_get_serial_sequence(${seqTarget}, 'id'), COALESCE((SELECT MAX(id) FROM ${quotedTable}), 0));`
    );
}

async function migrate() {
    console.log('🔌 Connecting to Postgres...');
    await db.sequelize.authenticate();
    console.log('✅ Postgres connected');

    const sqlite = new sqlite3.Database(SQLITE_PATH);

    for (const entry of TABLES) {
        const exists = await tableExists(sqlite, entry.table);
        if (!exists) {
            console.log(`⏭️  Skipping ${entry.table} (not found)`);
            continue;
        }

        const rows = await fetchAll(sqlite, entry.table);
        if (rows.length === 0) {
            console.log(`⏭️  Skipping ${entry.table} (0 rows)`);
            continue;
        }

        const fields = Object.keys(entry.model.rawAttributes);
        const cleanedRows = rows.map((row) => pickFields(row, fields));
        const filteredRows = await filterByForeignKeys(entry.table, cleanedRows);

        if (filteredRows.length === 0) {
            console.log(`⏭️  Skipping ${entry.table} (no valid rows)`);
            continue;
        }

        await entry.model.bulkCreate(filteredRows, {
            validate: false,
            hooks: false,
            ignoreDuplicates: true
        });

        await resetSequence(entry.model);
        console.log(`✅ Migrated ${entry.table}: ${filteredRows.length}`);
    }

    sqlite.close();
    console.log('🎉 Migration complete');
}

migrate().catch((error) => {
    console.error('❌ Migration failed:', error);
    process.exit(1);
});
