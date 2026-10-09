const Booking = require('../models/Booking');
const Room = require('../models/Room');
const { successResponse, errorResponse } = require('../utils/apiResponse');

// @desc    Get All Bookings / TapeChart Reservations List
// @route   GET /api/bookings
// @access  Private
exports.getBookings = async (req, res, next) => {
  try {
    const { status, roomNumber } = req.query;
    let query = {};

    if (status) query.status = status;
    if (roomNumber) query.roomNumber = roomNumber;

    const bookings = await Booking.find(query).sort({ checkInDate: 1 });
    return successResponse(res, 'Bookings retrieved', bookings);
  } catch (err) {
    next(err);
  }
};

// @desc    Create New Reservation / Walk-In Guest
// @route   POST /api/bookings
// @access  Private
exports.createBooking = async (req, res, next) => {
  try {
    const {
      guestName,
      guestEmail,
      guestPhone,
      roomNumber,
      roomType,
      checkInDate,
      checkOutDate,
      nights,
      adults,
      children,
      ratePerNight,
      bookingSource
    } = req.body;

    // Verify physical room exists
    const roomObj = await Room.findOne({ roomNumber });
    if (!roomObj) return errorResponse(res, `Room ${roomNumber} does not exist`, 400);

    const numNights = Number(nights) || 1;
    const nightRate = Number(ratePerNight || roomObj.ratePerNight || 150);
    const totalAmount = numNights * nightRate;

    const bookingId = `BK-${Date.now().toString().slice(-6)}`;
    const resCode = `RES-${Math.floor(1000 + Math.random() * 9000)}`;

    const booking = await Booking.create({
      id: bookingId,
      resCode,
      guestName,
      guestEmail,
      guestPhone,
      roomNumber,
      roomType: roomType || roomObj.roomType,
      checkInDate,
      checkOutDate,
      nights: numNights,
      adults: adults || 1,
      children: children || 0,
      ratePerNight: nightRate,
      totalAmount,
      balanceDue: totalAmount,
      bookingSource: bookingSource || 'Walk-In'
    });

    return successResponse(res, 'Booking created successfully', booking, 201);
  } catch (err) {
    next(err);
  }
};

exports.checkInGuest = async (req, res, next) => {
  try {
    const booking = await Booking.findOne({ id: req.params.id }) || await Booking.findById(req.params.id);
    if (!booking) return errorResponse(res, 'Booking not found', 404);

    booking.status = 'Checked In';
    await booking.save();

    // Update Room Status to Occupied
    await Room.findOneAndUpdate({ roomNumber: booking.roomNumber }, { foStatus: 'Occupied' });

    return successResponse(res, `Guest ${booking.guestName} checked in to Room ${booking.roomNumber}`, booking);
  } catch (err) {
    next(err);
  }
};

exports.checkOutGuest = async (req, res, next) => {
  try {
    const booking = await Booking.findOne({ id: req.params.id }) || await Booking.findById(req.params.id);
    if (!booking) return errorResponse(res, 'Booking not found', 404);

    if (booking.balanceDue > 0.05) {
      return errorResponse(res, `Cannot checkout! Balance due of $${booking.balanceDue.toFixed(2)} remaining on folio.`, 400);
    }

    booking.status = 'Checked Out';
    await booking.save();

    // Update Room Status to Vacant Dirty
    await Room.findOneAndUpdate({ roomNumber: booking.roomNumber }, { foStatus: 'Vacant', housekeepingStatus: 'Dirty' });

    return successResponse(res, `Guest ${booking.guestName} checked out successfully`, booking);
  } catch (err) {
    next(err);
  }
};