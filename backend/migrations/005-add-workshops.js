const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { sequelize, Workshop, WorkshopSession, CodeBundle, CodeSection, RealtimeEventLog } = require('../models');

async function up() {
    await sequelize.authenticate();
    await Workshop.sync();
    await WorkshopSession.sync();
    await CodeBundle.sync();
    await CodeSection.sync();
    await RealtimeEventLog.sync();
    console.log('Workshop tables created.');
}

up().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
