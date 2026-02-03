const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AttendanceRecord = sequelize.define('AttendanceRecord', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    sessionId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    eventId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    memberId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    deviceHash: {
        type: DataTypes.STRING,
        allowNull: true
    },
    checkedInAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    indexes: [
        {
            unique: true,
            fields: ['sessionId', 'memberId'],
            name: 'unique_session_member'
        },
        { fields: ['eventId'] }
    ]
});

module.exports = AttendanceRecord;
