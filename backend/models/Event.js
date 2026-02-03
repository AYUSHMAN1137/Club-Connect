const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Event = sequelize.define('Event', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    title: {
        type: DataTypes.STRING,
        allowNull: false
    },
    date: {
        type: DataTypes.DATEONLY,
        allowNull: false
    },
    // Proper time fields (sortable, queryable)
    startTime: {
        type: DataTypes.DATE,
        allowNull: true
    },
    endTime: {
        type: DataTypes.DATE,
        allowNull: true
    },
    venue: {
        type: DataTypes.STRING
    },
    description: {
        type: DataTypes.TEXT
    },
    qrCode: {
        type: DataTypes.TEXT // Stores base64 string
    },
    // Event capacity (null = unlimited)
    capacity: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: null,
        validate: { min: 1 }
    },
    // Event status (using STRING for SQLite compatibility)
    status: {
        type: DataTypes.STRING,
        defaultValue: 'upcoming',
        validate: {
            isIn: [['upcoming', 'ongoing', 'completed', 'cancelled']]
        }
    },
    clubId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Clubs', key: 'id' },
        onDelete: 'CASCADE'
    }
    // REMOVED: rsvpList - now use EventRSVPs table instead
}, {
    indexes: [
        { fields: ['clubId'] },
        { fields: ['date'] },
        { fields: ['status'] }
    ]
});

module.exports = Event;
