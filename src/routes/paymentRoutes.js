const express = require('express');
const router = express.Router();
const { postPayment, refundPayment } = require('../controllers/paymentController');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');

router.use(protect);

router.post('/', postPayment);
router.post('/refund', authorize('SuperAdmin', 'Manager'), refundPayment);

module.exports = router;