const express = require('express');
const router = express.Router();
const { getAuditLogs } = require('../controllers/auditLogController');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');
router.use(protect);
router.use(authorize('SuperAdmin', 'Manager'));

router.get('/', getAuditLogs);

module.exports = router;