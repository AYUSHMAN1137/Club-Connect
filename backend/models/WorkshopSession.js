const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const WorkshopSession = sequelize.define('WorkshopSession', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    workshopId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    sessionToken: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    isLive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    previewEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'DRAFT'
    },
    isSectionsPublished: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    startedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    endedAt: {
        type: DataTypes.DATE,
        allowNull: true
    }
});

module.exports = WorkshopSession;
