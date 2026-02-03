const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Club = sequelize.define('Club', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    tagline: {
        type: DataTypes.STRING
    },
    // Club category (using STRING for SQLite compatibility)
    category: {
        type: DataTypes.STRING,
        defaultValue: 'Other',
        validate: {
            isIn: [['Technical', 'Cultural', 'Sports', 'Social', 'Academic', 'Other']]
        }
    },
    themeColor: {
        type: DataTypes.STRING,
        defaultValue: '#000000'
    },
    logo: {
        type: DataTypes.STRING
    },
    description: {
        type: DataTypes.TEXT
    },
    ownerId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'Users',
            key: 'id'
        }
    }
}, {
    indexes: [
        { fields: ['ownerId'] },
        { fields: ['category'] }
    ]
});

module.exports = Club;
