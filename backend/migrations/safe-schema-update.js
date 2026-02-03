/**
 * 🔄 SAFE SCHEMA MIGRATION
 * Adds new columns using raw SQL for SQLite compatibility
 * 
 * Usage: node migrations/safe-schema-update.js
 */

const { sequelize } = require('../models');

async function safeSchemaUpdate() {
    console.log('\n🔄 Safe Schema Update...\n');

    try {
        await sequelize.authenticate();
        console.log('✅ Database connected\n');

        // Helper to safely add column (ignores if already exists)
        async function addColumn(table, column, type, defaultValue = null) {
            try {
                let sql = `ALTER TABLE ${table} ADD COLUMN ${column} ${type}`;
                if (defaultValue !== null) {
                    sql += ` DEFAULT '${defaultValue}'`;
                }
                await sequelize.query(sql);
                console.log(`  ✅ Added ${table}.${column}`);
            } catch (err) {
                if (err.message.includes('duplicate column') || err.message.includes('already exists')) {
                    console.log(`  ⏭️ ${table}.${column} already exists`);
                } else {
                    console.log(`  ⚠️ ${table}.${column}: ${err.message}`);
                }
            }
        }

        // Helper to create index (ignores if already exists)
        async function addIndex(table, columns, unique = false, name = null) {
            try {
                const indexName = name || `idx_${table}_${columns.join('_')}`;
                const uniqueStr = unique ? 'UNIQUE' : '';
                const sql = `CREATE ${uniqueStr} INDEX IF NOT EXISTS ${indexName} ON ${table}(${columns.join(', ')})`;
                await sequelize.query(sql);
                console.log(`  ✅ Created index ${indexName}`);
            } catch (err) {
                console.log(`  ⚠️ Index ${name || columns.join('_')}: ${err.message}`);
            }
        }

        console.log('📦 Adding new columns to Events...');
        await addColumn('Events', 'startTime', 'DATETIME');
        await addColumn('Events', 'endTime', 'DATETIME');
        await addColumn('Events', 'capacity', 'INTEGER');
        await addColumn('Events', 'status', 'VARCHAR(20)', 'upcoming');

        console.log('\n📦 Adding new columns to Clubs...');
        await addColumn('Clubs', 'category', 'VARCHAR(50)', 'Other');

        console.log('\n📦 Adding new columns to Announcements...');
        await addColumn('Announcements', 'createdById', 'INTEGER');

        console.log('\n📦 Creating indexes...');
        await addIndex('Events', ['clubId']);
        await addIndex('Events', ['date']);
        await addIndex('Events', ['status']);
        await addIndex('Clubs', ['ownerId']);
        await addIndex('Clubs', ['category']);
        await addIndex('Announcements', ['clubId']);
        await addIndex('Announcements', ['createdById']);
        await addIndex('Attendances', ['eventId', 'userId'], true, 'unique_attendance_per_event');
        await addIndex('PointHistories', ['userId']);
        await addIndex('PointHistories', ['clubId']);
        await addIndex('Notifications', ['userId']);

        console.log('\n✅ Schema update complete!');

    } catch (error) {
        console.error('\n❌ Schema update failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    safeSchemaUpdate().then(() => process.exit(0));
}

module.exports = safeSchemaUpdate;
