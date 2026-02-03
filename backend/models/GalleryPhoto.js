const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const GalleryPhoto = sequelize.define('GalleryPhoto', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    eventId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    filename: {
        type: DataTypes.STRING,
        allowNull: false
    },
    originalName: {
        type: DataTypes.STRING,
        allowNull: true
    },
    fileSize: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    url: {
        type: DataTypes.STRING,
        allowNull: false
    },
    uploadedAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    indexes: [
        { fields: ['eventId'] },
        { fields: ['uploadedAt'] },
        { fields: ['eventId', 'originalName', 'fileSize'] }
    ]
});

module.exports = GalleryPhoto;

