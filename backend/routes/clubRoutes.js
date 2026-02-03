const express = require('express');
const router = express.Router();
const clubController = require('../controllers/clubController');

router.get('/', clubController.getAllClubs);
router.get('/:id', clubController.getClubDetails);

module.exports = router;
