const { Sequelize } = require('sequelize');
const path = require('path');

const dbMode = String(process.env.DB_MODE || '').toLowerCase();
const onlineUrl = process.env.ONLINE_DB_URL || '';
const localUrl = process.env.LOCAL_DB_URL || '';
let databaseUrl = process.env.DATABASE_URL || '';

if (!databaseUrl) {
    if (dbMode === 'online' && onlineUrl) {
        databaseUrl = onlineUrl;
    } else if ((dbMode === 'offline' || dbMode === 'local') && localUrl) {
        databaseUrl = localUrl;
    } else if (onlineUrl && !localUrl) {
        databaseUrl = onlineUrl;
    } else if (localUrl) {
        databaseUrl = localUrl;
    }
} else if (dbMode === 'online' && onlineUrl) {
    databaseUrl = onlineUrl;
} else if ((dbMode === 'offline' || dbMode === 'local') && localUrl) {
    databaseUrl = localUrl;
}

let sequelize;

const forceSqlite = dbMode === 'sqlite' || dbMode === 'sqlite3';

if (!forceSqlite && databaseUrl) {
    const isLocalPostgres = /localhost|127\.0\.0\.1/i.test(databaseUrl);

    const options = {
        dialect: 'postgres',
        logging: false,
        pool: {
            max: 20,
            min: 2,
            acquire: 30000,
            idle: 10000,
            evict: 60000
        },
        retry: {
            max: 3
        }
    };

    if (!isLocalPostgres) {
        options.dialectOptions = {
            ssl: {
                require: true,
                rejectUnauthorized: false
            }
        };
    }

    sequelize = new Sequelize(databaseUrl, options);
    const resolvedMode = dbMode || (isLocalPostgres ? 'offline' : 'online');
    sequelize.connectionUrl = databaseUrl;
    sequelize.connectionMode = resolvedMode;
    sequelize.isLocalPostgres = isLocalPostgres;
} else {
    const sqlitePath = process.env.SQLITE_PATH || path.join(__dirname, '..', 'database.sqlite');
    sequelize = new Sequelize({
        dialect: 'sqlite',
        storage: sqlitePath,
        logging: false
    });
    sequelize.connectionUrl = sqlitePath;
    sequelize.connectionMode = forceSqlite ? 'sqlite' : (dbMode || 'sqlite');
    sequelize.isLocalPostgres = false;
}

module.exports = sequelize;
