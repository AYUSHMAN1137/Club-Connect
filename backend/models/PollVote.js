const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PollVote = sequelize.define('PollVote', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    pollId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Polls', key: 'id' },
        onDelete: 'CASCADE'
    },
    optionId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'PollOptions', key: 'id' },
        onDelete: 'CASCADE'
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onDelete: 'CASCADE'
    }
}, {
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    indexes: [
        { unique: true, fields: ['pollId', 'userId'] },
        { fields: ['pollId'] },
        { fields: ['optionId'] }
    ]
});

module.exports = PollVote;
