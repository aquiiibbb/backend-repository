const express = require('express');
const router = express.Router();
const {
  getBookings,
  createBooking,
  checkInGuest,
  checkOutGuest
} = require('../controllers/bookingController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/', getBookings);
router.post('/', createBooking);
router.patch('/:id/checkin', checkInGuest);
router.patch('/:id/checkout', checkOutGuest);

module.exports = router;