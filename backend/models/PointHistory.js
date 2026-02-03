const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PointHistory = sequelize.define('PointHistory', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    clubId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    points: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    reason: {
        type: DataTypes.STRING,
        allowNull: false
    },
    performedBy: {
        type: DataTypes.STRING,
        defaultValue: 'System'
    },
    createdAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    indexes: [
        { fields: ['userId'] },
        { fields: ['clubId'] },
        { fields: ['createdAt'] }
    ]
});

module.exports = PointHistory;
