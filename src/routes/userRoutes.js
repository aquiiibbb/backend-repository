const express = require('express');
const router = express.Router();
const { getUsers, createUser, updateUser } = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');

router.use(protect);
router.use(authorize('SuperAdmin', 'Manager'));

router.get('/', getUsers);
router.post('/', createUser);
router.put('/:id', updateUser);

module.exports = router;