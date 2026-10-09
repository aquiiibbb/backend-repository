const express = require('express');
const router = express.Router();
const { collectDeposit, applyDeposit, refundDeposit } = require('../controllers/depositController');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');

router.use(protect);

router.post('/collect', collectDeposit);
router.post('/apply', applyDeposit);
router.post('/refund', authorize('SuperAdmin', 'Manager'), refundDeposit);

module.exports = router;