const express = require('express');
const router = express.Router();
const {
  getRoomTypes,
  createRoomType,
  getRooms,
  createRoom,
  updateHousekeeping,
  toggleRoomBlock
} = require('../controllers/roomController');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');

router.use(protect);

// Room Categories
router.get('/types', getRoomTypes);
router.post('/types', authorize('SuperAdmin', 'Manager'), createRoomType);

// Physical Rooms
router.get('/', getRooms);
router.post('/', authorize('SuperAdmin', 'Manager'), createRoom);
router.patch('/:id/housekeeping', updateHousekeeping);
router.patch('/:id/block', authorize('SuperAdmin', 'Manager'), toggleRoomBlock);

module.exports = router;