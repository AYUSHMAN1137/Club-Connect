const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AttendanceSession = sequelize.define('AttendanceSession', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    eventId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    ownerId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'active',
        validate: {
            isIn: [['active', 'closed']]
        }
    },
    expiresAt: {
        type: DataTypes.DATE,
        allowNull: false
    },
    currentNonce: {
        type: DataTypes.STRING,
        allowNull: false
    },
    currentCode: {
        type: DataTypes.STRING(7),
        allowNull: true
    },
    createdAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    indexes: [
        { fields: ['eventId'] },
        { fields: ['status'] }
    ]
});

module.exports = AttendanceSession;
