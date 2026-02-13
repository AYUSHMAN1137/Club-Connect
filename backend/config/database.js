const { Sequelize } = require('sequelize');

const databaseUrl = process.env.DATABASE_URL;

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