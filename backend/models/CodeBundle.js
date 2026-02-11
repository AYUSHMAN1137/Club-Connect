const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const CodeBundle = sequelize.define('CodeBundle', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    sessionId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    authorId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    language: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'plaintext'
    },
    rawCode: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    savedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    versionNumber: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1
    },
    isPublished: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
    }
});

module.exports = CodeBundle;
