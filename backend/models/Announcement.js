const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Announcement = sequelize.define('Announcement', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    title: {
        type: DataTypes.STRING,
        allowNull: false
    },
    message: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    date: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    clubId: {
        type: DataTypes.INTEGER,
        allowNull: true // Null = global announcement
    },
    // CHANGED: From string username to proper foreign key
    createdById: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'Users',
            key: 'id'
        }
    },
    // DEPRECATED: Keep for backward compatibility during migration
    createdBy: {
        type: DataTypes.STRING,
        allowNull: true
    }
}, {
    indexes: [
        { fields: ['clubId'] },
        { fields: ['createdById'] },
        { fields: ['date'] }
    ]
});

module.exports = Announcement;
