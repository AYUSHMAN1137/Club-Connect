const { Sequelize } = require('sequelize');

const dbMode = String(process.env.DB_MODE || '').toLowerCase();
const onlineUrl = process.env.ONLINE_DB_URL || '';
let databaseUrl = process.env.DATABASE_URL || '';

if (dbMode === 'online' && onlineUrl) {
    databaseUrl = onlineUrl;
}

let sequelize;

if (databaseUrl) {
    const isLocalPostgres = /localhost|127\.0\.0\.1/i.test(databaseUrl);

    const options = {
        dialect: 'postgres',
        logging: false
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
} else {
    // Default: local PostgreSQL (no SQLite fallback)
    sequelize = new Sequelize('club_connect', 'postgres', 'postgres', {
        host: 'localhost',
        port: 5432,
        dialect: 'postgres',
        logging: false
    });
}

module.exports = sequelize;
