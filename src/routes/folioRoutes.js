const express = require('express');
const router = express.Router();
const { getFolio, postCharge } = require('../controllers/folioController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/:bookingId', getFolio);
router.post('/:bookingId/charge', postCharge);

module.exports = router;