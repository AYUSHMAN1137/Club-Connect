const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const RealtimeEventLog = sequelize.define('RealtimeEventLog', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    sessionId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    eventType: {
        type: DataTypes.STRING,
        allowNull: false
    },
    actorId: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    payload: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: {}
    },
    timestamp: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    }
});

module.exports = RealtimeEventLog;
