const { Club, User, Membership } = require('../models');

// Get All Clubs
exports.getAllClubs = async (req, res) => {
    try {
        const clubs = await Club.findAll({
            include: [
                { model: User, as: 'Owner', attributes: ['username', 'email'] }
            ]
        });
        res.json(clubs);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get Single Club with Member Details
exports.getClubDetails = async (req, res) => {
    try {
        const club = await Club.findByPk(req.params.id, {
            include: [
                {
                    model: User,
                    through: { attributes: ['rank', 'points', 'status'] } // Get membership details
                }
            ]
        });
        if (!club) return res.status(404).json({ message: 'Club not found' });
        res.json(club);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
