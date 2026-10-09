const express = require('express');
const router = express.Router();
const { getMasterReport } = require('../controllers/reportController');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');

router.use(protect);
router.use(authorize('SuperAdmin', 'Manager'));

router.get('/master', getMasterReport);

module.exports = router;