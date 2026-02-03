const { Sequelize } = require('sequelize');
const path = require('path');

// Connect to the SQLite database file
const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: path.join(__dirname, '../database.sqlite'), // Points to backend/database.sqlite
    logging: false // Set to console.log to see raw SQL queries
});

// IMPORTANT: SQLite enforces foreign keys per connection.
// This hook makes sure every connection has FK constraints enabled.
sequelize.addHook('afterConnect', async (connection) => {
    await new Promise((resolve, reject) => {
        connection.run('PRAGMA foreign_keys = ON;', (err) => {
            if (err) return reject(err);
            resolve();
        });
    });
});

module.exports = sequelize;
