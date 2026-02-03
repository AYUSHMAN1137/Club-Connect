const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const User = sequelize.define('User', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    studentId: {
        type: DataTypes.STRING, /* e.g. "1137" */
        allowNull: false,
        unique: true
    },
    username: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
            isEmail: true
        }
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false
    },
    role: {
        type: DataTypes.STRING, /* 'member', 'owner', 'admin' */
        defaultValue: 'member'
    },
    // Profile details
    profilePic: {
        type: DataTypes.STRING,
        defaultValue: ''
    },
    bio: {
        type: DataTypes.TEXT,
        defaultValue: ''
    },
    phone: {
        type: DataTypes.STRING,
        defaultValue: ''
    },
    department: {
        type: DataTypes.STRING,
        defaultValue: ''
    }
}, {
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
});

module.exports = User;
