const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const CodeSection = sequelize.define('CodeSection', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    sessionId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    codeBundleId: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    startLine: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    endLine: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    language: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'plaintext'
    },
    content: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: ''
    },
    visible: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    orderIndex: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    }
});

module.exports = CodeSection;
