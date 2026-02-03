const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PollOption = sequelize.define('PollOption', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    pollId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Polls', key: 'id' },
        onDelete: 'CASCADE'
    },
    text: {
        type: DataTypes.STRING,
        allowNull: false
    },
    order: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        validate: { min: 0 }
    }
}, {
    timestamps: false,
    indexes: [
        { fields: ['pollId'] }
    ]
});

module.exports = PollOption;
