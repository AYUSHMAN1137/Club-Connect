const { Sequelize } = require('sequelize');
const path = require('path');

const databaseUrl = process.env.DATABASE_URL;
let sequelize;

if (databaseUrl) {
    sequelize = new Sequelize(databaseUrl, {
        dialect: 'postgres',
        logging: false,
        dialectOptions: {
            ssl: {
                require: true,
                rejectUnauthorized: false
            }
        }
    });
} else {
    sequelize = new Sequelize({
        dialect: 'sqlite',
        storage: path.join(__dirname, '../database.sqlite'),
        logging: false
    });

    sequelize.addHook('afterConnect', async (connection) => {
        await new Promise((resolve, reject) => {
            connection.run('PRAGMA foreign_keys = ON;', (err) => {
                if (err) return reject(err);
                resolve();
            });
        });
    });
}

module.exports = sequelize;
