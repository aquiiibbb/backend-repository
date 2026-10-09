const express = require('express');
const router = express.Router();
const { runNightAudit, getNightAuditHistory } = require('../controllers/nightAuditController');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');

router.use(protect);

router.post('/run', authorize('SuperAdmin', 'Manager'), runNightAudit);
router.get('/history', getNightAuditHistory);

module.exports = router;