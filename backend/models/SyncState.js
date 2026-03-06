const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SyncState = sequelize.define('SyncState', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    clubId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    module: {
        type: DataTypes.STRING,
        allowNull: false
    },
    version: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1
    },
    updatedAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'SyncStates',
    timestamps: false,
    indexes: [
        { unique: true, fields: ['clubId', 'module'] }
    ]
});

module.exports = SyncState;
