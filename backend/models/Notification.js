const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Notification = sequelize.define('Notification', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    title: {
        type: DataTypes.STRING,
        allowNull: false
    },
    message: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    // Using STRING for SQLite compatibility
    type: {
        type: DataTypes.STRING,
        defaultValue: 'system',
        validate: {
            isIn: [['announcement', 'points', 'event', 'system']]
        }
    },
    isRead: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    createdAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    indexes: [
        { fields: ['userId'] },
        { fields: ['isRead'] },
        { fields: ['createdAt'] }
    ]
});

module.exports = Notification;
