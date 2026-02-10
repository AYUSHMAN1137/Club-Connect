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
        unique: true,
        validate: {
            notEmpty: true
        }
    },
    username: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
            notEmpty: true
        }
    },
    email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
            isEmail: true,
            notEmpty: true
        }
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            notEmpty: true
        }
    },
    role: {
        type: DataTypes.STRING, /* 'member', 'owner', 'admin' */
        allowNull: false,
        defaultValue: 'member',
        validate: {
            isIn: [['member', 'owner', 'admin']]
        }
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
    },
    activeClubId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'Clubs', key: 'id' }
    }
}, {
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
});

module.exports = User;
