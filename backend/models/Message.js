const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Message model
 * Supports direct messages (senderId <-> recipientId) and optional club messages.
 */
const Message = sequelize.define('Message', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    senderId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'Users',
            key: 'id'
        }
    },
    recipientId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'Users',
            key: 'id'
        }
    },
    clubId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'Clubs',
            key: 'id'
        }
    },
    type: {
        type: DataTypes.STRING,
        defaultValue: 'direct',
        validate: {
            isIn: [['direct', 'club']]
        }
    },
    message: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    isRead: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    readAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    // Soft-delete: per-user "clear chat" — only hides from that user's view
    deletedBySender: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    deletedByRecipient: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    createdAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    indexes: [
        { fields: ['senderId', 'recipientId'] },
        { fields: ['clubId', 'createdAt'] },
        { fields: ['type'] },
        { fields: ['isRead'] },
        { fields: ['createdAt'] }
    ],
    timestamps: false
});

module.exports = Message;

