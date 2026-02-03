/**
 * Add Poll, PollOption, PollVote tables
 * Run: node migrations/003-add-polls.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { sequelize, Poll, PollOption, PollVote } = require('../models');

async function up() {
    await sequelize.authenticate();
    await Poll.sync();
    await PollOption.sync();
    await PollVote.sync();
    console.log('✅ Poll tables created.');
}

up().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
