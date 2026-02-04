const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ClubOwner = sequelize.define('ClubOwner', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    clubId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Clubs', key: 'id' },
        onDelete: 'CASCADE'
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onDelete: 'CASCADE'
    }
}, {
    indexes: [
        { unique: true, fields: ['clubId', 'userId'] },
        { fields: ['userId'] }
    ]
});

module.exports = ClubOwner;
