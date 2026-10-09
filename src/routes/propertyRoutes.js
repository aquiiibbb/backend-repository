const express = require('express');
const router = express.Router();
const { getProperty, updateProperty } = require('../controllers/propertyController');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');

router.use(protect);

router.get('/', getProperty);
router.put('/', authorize('SuperAdmin', 'Manager'), updateProperty);

module.exports = router;