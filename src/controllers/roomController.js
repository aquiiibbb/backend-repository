const Room = require('../models/Room');
const RoomType = require('../models/RoomType');
const { successResponse, errorResponse } = require('../utils/apiResponse');

// ----------------------------------------------------
// ROOM TYPES CONTROLLERS
// ----------------------------------------------------

// @desc    Get All Room Categories
// @route   GET /api/rooms/types
// @access  Private
exports.getRoomTypes = async (req, res, next) => {
  try {
    const roomTypes = await RoomType.find();
    return successResponse(res, 'Room types retrieved', roomTypes);
  } catch (err) {
    next(err);
  }
};

// @desc    Create New Room Category
// @route   POST /api/rooms/types
// @access  Private (Manager / SuperAdmin)
exports.createRoomType = async (req, res, next) => {
  try {
    const { typeId, name, baseRate, maxOccupancy, description, amenities } = req.body;

    const exists = await RoomType.findOne({ typeId });
    if (exists) return errorResponse(res, 'Room type ID already exists', 400);

    const roomType = await RoomType.create({ typeId, name, baseRate, maxOccupancy, description, amenities });
    return successResponse(res, 'Room type created', roomType, 201);
  } catch (err) {
    next(err);
  }
};

// ----------------------------------------------------
// PHYSICAL ROOMS & HOUSEKEEPING CONTROLLERS
// ----------------------------------------------------

// @desc    Get All Physical Rooms & Housekeeping Status
// @route   GET /api/rooms
// @access  Private
exports.getRooms = async (req, res, next) => {
  try {
    const rooms = await Room.find().sort({ roomNumber: 1 });
    return successResponse(res, 'Rooms retrieved', rooms);
  } catch (err) {
    next(err);
  }
};

// @desc    Create Physical Room
// @route   POST /api/rooms
// @access  Private (Manager / SuperAdmin)
exports.createRoom = async (req, res, next) => {
  try {
    const { roomNumber, roomType, floor, ratePerNight } = req.body;

    const exists = await Room.findOne({ roomNumber });
    if (exists) return errorResponse(res, `Room ${roomNumber} already exists`, 400);

    const room = await Room.create({ roomNumber, roomType, floor, ratePerNight });
    return successResponse(res, 'Room created successfully', room, 201);
  } catch (err) {
    next(err);
  }
};

// @desc    Update Housekeeping Status (Clean, Dirty, Inspected, Out of Service)
// @route   PATCH /api/rooms/:id/housekeeping
// @access  Private (Housekeeping / FrontDesk / Manager)
exports.updateHousekeeping = async (req, res, next) => {
  try {
    const { housekeepingStatus } = req.body;
    const room = await Room.findById(req.params.id);

    if (!room) return errorResponse(res, 'Room not found', 404);

    if (!['Clean', 'Dirty', 'Inspected', 'Out of Service', 'Maintenance'].includes(housekeepingStatus)) {
      return errorResponse(res, 'Invalid housekeeping status value', 400);
    }

    room.housekeepingStatus = housekeepingStatus;
    await room.save();

    return successResponse(res, `Room ${room.roomNumber} housekeeping set to ${housekeepingStatus}`, room);
  } catch (err) {
    next(err);
  }
};

// @desc    Toggle Room Maintenance Block
// @route   PATCH /api/rooms/:id/block
// @access  Private (Manager / SuperAdmin)
exports.toggleRoomBlock = async (req, res, next) => {
  try {
    const { isBlocked, blockReason } = req.body;
    const room = await Room.findById(req.params.id);

    if (!room) return errorResponse(res, 'Room not found', 404);

    room.isBlocked = typeof isBlocked === 'boolean' ? isBlocked : !room.isBlocked;
    room.blockReason = blockReason || (room.isBlocked ? 'Maintenance Block' : '');
    await room.save();

    return successResponse(res, `Room ${room.roomNumber} block status updated`, room);
  } catch (err) {
    next(err);
  }
};