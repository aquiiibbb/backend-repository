const express = require('express');
const router = express.Router();
const { getGuests, createGuest, updateGuest } = require('../controllers/guestController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/', getGuests);
router.post('/', createGuest);
router.put('/:id', updateGuest);

module.exports = router;