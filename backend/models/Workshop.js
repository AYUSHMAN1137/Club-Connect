const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Workshop = sequelize.define('Workshop', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    title: {
        type: DataTypes.STRING,
        allowNull: false
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: ''
    },
    instructorId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    clubId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    startTime: {
        type: DataTypes.DATE,
        allowNull: true
    },
    endTime: {
        type: DataTypes.DATE,
        allowNull: true
    },
    status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'upcoming'
    },
    requiredTools: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: []
    }
});

module.exports = Workshop;
