const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Poll = sequelize.define('Poll', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    question: {
        type: DataTypes.STRING,
        allowNull: false
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'active',
        validate: {
            isIn: [['active', 'closed']]
        }
    },
    endDate: {
        type: DataTypes.DATEONLY,
        allowNull: true
    },
    clubId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Clubs', key: 'id' },
        onDelete: 'CASCADE'
    },
    createdById: {
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
        { fields: ['clubId'] },
        { fields: ['status'] },
        { fields: ['createdAt'] }
    ]
});

module.exports = Poll;
