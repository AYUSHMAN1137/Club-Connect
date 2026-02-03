const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const MemberProject = sequelize.define('MemberProject', {
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
    projectIdeaId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'ProjectIdeas', key: 'id' },
        onDelete: 'SET NULL'
    },
    projectTitleSnapshot: {
        type: DataTypes.STRING,
        allowNull: true
    },
    projectDescriptionSnapshot: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'not_started',
        validate: {
            isIn: [['not_started', 'in_progress', 'completed']]
        }
    },
    progressPercent: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        validate: { min: 0, max: 100 }
    },
    approvalStatus: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
            isIn: [['pending', 'approved', 'rejected']]
        }
    },
    startedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    completedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    approvedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    lastUpdatedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    isArchived: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }
}, {
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    indexes: [
        // Removed unique constraint to allow multiple projects per user
        { fields: ['userId'] },
        { fields: ['clubId'] },
        { fields: ['projectIdeaId'] },
        { fields: ['userId', 'clubId'] }  // Non-unique composite index for queries
    ]
});

module.exports = MemberProject;
