const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ProjectIdea = sequelize.define('ProjectIdea', {
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
    title: {
        type: DataTypes.STRING,
        allowNull: false
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    }
}, {
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    indexes: [{ fields: ['clubId'] }]
});

module.exports = ProjectIdea;
