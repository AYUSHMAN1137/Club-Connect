const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Membership = sequelize.define('Membership', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onDelete: 'CASCADE'
    },
    clubId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Clubs', key: 'id' },
        onDelete: 'CASCADE'
    },
    points: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        validate: { min: 0 }
    },
    rank: {
        type: DataTypes.STRING,
        defaultValue: 'Rookie'
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'active' /* or 'pending' */
    },
    joinedAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    indexes: [
        {
            unique: true,
            fields: ['userId', 'clubId']
        },
        { fields: ['clubId'] },
        { fields: ['points'] }
    ]
});

module.exports = Membership;
