/**
 * Add ProjectIdea, MemberProject, MemberProjectHistory tables
 * Run: node migrations/004-add-project-ideas-and-member-projects.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { sequelize, ProjectIdea, MemberProject, MemberProjectHistory } = require('../models');

async function up() {
    await sequelize.authenticate();
    await ProjectIdea.sync();
    await MemberProject.sync();
    await MemberProjectHistory.sync();
    console.log('Project idea and member project tables created.');
}

up().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
