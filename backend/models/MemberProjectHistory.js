const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const MemberProjectHistory = sequelize.define('MemberProjectHistory', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    memberProjectId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'MemberProjects', key: 'id' },
        onDelete: 'CASCADE'
    },
    oldProjectIdeaId: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    newProjectIdeaId: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    changedAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    timestamps: false,
    indexes: [{ fields: ['memberProjectId'] }]
});

module.exports = MemberProjectHistory;
