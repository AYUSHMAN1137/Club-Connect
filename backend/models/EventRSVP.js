const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const EventRSVP = sequelize.define('EventRSVP', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    eventId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    // Using STRING for SQLite compatibility
    status: {
        type: DataTypes.STRING,
        defaultValue: 'going',
        validate: {
            isIn: [['going', 'not_going', 'maybe']]
        }
    },
    timestamp: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    indexes: [
        {
            unique: true,
            fields: ['eventId', 'userId']
        }
    ]
});

module.exports = EventRSVP;
