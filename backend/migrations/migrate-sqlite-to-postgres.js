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

async function resetSequence(model) {
    if (!model.rawAttributes.id || !model.rawAttributes.id.autoIncrement) return;
    const queryInterface = db.sequelize.getQueryInterface();
    const seqTable = getTableNameForSequence(model);
    const quotedTable = queryInterface.quoteTable(model.getTableName());
    await db.sequelize.query(
        `SELECT setval(pg_get_serial_sequence('${seqTable}', 'id'), COALESCE((SELECT MAX(id) FROM ${quotedTable}), 0));`
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

        await entry.model.bulkCreate(cleanedRows, {
            validate: false,
            hooks: false,
            ignoreDuplicates: true
        });

        await resetSequence(entry.model);
        console.log(`✅ Migrated ${entry.table}: ${rows.length}`);
    }

    sqlite.close();
    console.log('🎉 Migration complete');
}

migrate().catch((error) => {
    console.error('❌ Migration failed:', error);
    process.exit(1);
});
