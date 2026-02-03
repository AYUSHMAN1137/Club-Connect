/**
 * Migration Script: Remove Unique Constraint from MemberProjects
 * 
 * This script removes the unique constraint on (userId, clubId) 
 * to allow members to have multiple projects.
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database.sqlite');

console.log('🔄 Starting database migration...');
console.log(`📁 Database: ${dbPath}`);

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Error opening database:', err);
        process.exit(1);
    }
    console.log('✅ Database connected');
});

// Run migration
db.serialize(() => {
    console.log('\n📋 Step 1: Checking current schema...');

    // Get current table info
    db.all("PRAGMA table_info(MemberProjects)", (err, columns) => {
        if (err) {
            console.error('❌ Error getting table info:', err);
            db.close();
            process.exit(1);
        }

        console.log('✅ Current columns:', columns.map(c => c.name).join(', '));
    });

    // Get current indexes
    db.all("PRAGMA index_list(MemberProjects)", (err, indexes) => {
        if (err) {
            console.error('❌ Error getting indexes:', err);
            db.close();
            process.exit(1);
        }

        console.log('✅ Current indexes:', indexes.map(i => i.name).join(', '));

        // Check if unique index exists
        const uniqueIndex = indexes.find(i => i.unique === 1 && i.name.includes('user') && i.name.includes('club'));

        if (!uniqueIndex) {
            console.log('ℹ️  No unique constraint found - schema may already be updated');
        }
    });

    console.log('\n📋 Step 2: Creating backup table...');

    // Create backup of existing data
    db.run(`CREATE TABLE IF NOT EXISTS MemberProjects_backup AS SELECT * FROM MemberProjects`, (err) => {
        if (err) {
            console.error('❌ Error creating backup:', err);
            db.close();
            process.exit(1);
        }
        console.log('✅ Backup created');

        console.log('\n📋 Step 3: Recreating table without unique constraint...');

        // Drop the old table
        db.run(`DROP TABLE IF EXISTS MemberProjects`, (err) => {
            if (err) {
                console.error('❌ Error dropping table:', err);
                db.close();
                process.exit(1);
            }
            console.log('✅ Old table dropped');

            // Create new table without unique constraint
            db.run(`
                CREATE TABLE MemberProjects (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    userId INTEGER NOT NULL,
                    clubId INTEGER NOT NULL,
                    projectIdeaId INTEGER,
                    projectTitleSnapshot TEXT,
                    projectDescriptionSnapshot TEXT,
                    status TEXT DEFAULT 'not_started',
                    progressPercent INTEGER DEFAULT 0,
                    approvalStatus TEXT,
                    startedAt DATETIME,
                    completedAt DATETIME,
                    approvedAt DATETIME,
                    lastUpdatedAt DATETIME,
                    isArchived INTEGER DEFAULT 0,
                    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (userId) REFERENCES Users(id) ON DELETE CASCADE,
                    FOREIGN KEY (clubId) REFERENCES Clubs(id) ON DELETE CASCADE,
                    FOREIGN KEY (projectIdeaId) REFERENCES ProjectIdeas(id) ON DELETE SET NULL
                )
            `, (err) => {
                if (err) {
                    console.error('❌ Error creating new table:', err);
                    db.close();
                    process.exit(1);
                }
                console.log('✅ New table created');

                console.log('\n📋 Step 4: Restoring data from backup...');

                // Restore data
                db.run(`INSERT INTO MemberProjects SELECT * FROM MemberProjects_backup`, (err) => {
                    if (err) {
                        console.error('❌ Error restoring data:', err);
                        db.close();
                        process.exit(1);
                    }
                    console.log('✅ Data restored');

                    console.log('\n📋 Step 5: Creating indexes...');

                    // Create indexes
                    const indexes = [
                        `CREATE INDEX idx_memberprojects_userId ON MemberProjects(userId)`,
                        `CREATE INDEX idx_memberprojects_clubId ON MemberProjects(clubId)`,
                        `CREATE INDEX idx_memberprojects_projectIdeaId ON MemberProjects(projectIdeaId)`,
                        `CREATE INDEX idx_memberprojects_userId_clubId ON MemberProjects(userId, clubId)`
                    ];

                    let completed = 0;
                    indexes.forEach((sql, index) => {
                        db.run(sql, (err) => {
                            if (err) {
                                console.error(`❌ Error creating index ${index + 1}:`, err);
                            } else {
                                console.log(`✅ Index ${index + 1} created`);
                            }

                            completed++;
                            if (completed === indexes.length) {
                                console.log('\n📋 Step 6: Cleaning up...');

                                // Drop backup table
                                db.run(`DROP TABLE MemberProjects_backup`, (err) => {
                                    if (err) {
                                        console.error('❌ Error dropping backup:', err);
                                    } else {
                                        console.log('✅ Backup table removed');
                                    }

                                    console.log('\n✅ Migration completed successfully!');
                                    console.log('🎉 You can now have up to 3 projects per member!');

                                    db.close((err) => {
                                        if (err) {
                                            console.error('❌ Error closing database:', err);
                                        } else {
                                            console.log('✅ Database connection closed');
                                        }
                                        process.exit(0);
                                    });
                                });
                            }
                        });
                    });
                });
            });
        });
    });
});
