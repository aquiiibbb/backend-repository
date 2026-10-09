const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const Room = require('../models/Room');
const { successResponse, errorResponse } = require('../utils/apiResponse');
// @desc    Get Master Financial & Manager Report
// @route   GET /api/reports/master
// @access  Private (Manager / SuperAdmin)
exports.getMasterReport = async (req, res, next) => {
  try {
    const bookings = await Booking.find();
    const payments = await Payment.find();
    const rooms = await Room.find();

    const totalRooms = rooms.length || 1;
    const occupiedCount = rooms.filter((r) => r.foStatus === 'Occupied').length;
    const occupancyRate = Math.round((occupiedCount / totalRooms) * 100);

    const totalRevenue = bookings.reduce((sum, b) => sum + (b.totalAmount || 0), 0);
    const totalCollected = payments.reduce((sum, p) => sum + (p.amountUSD || 0), 0);
    const totalBalanceDue = bookings.reduce((sum, b) => sum + (b.balanceDue || 0), 0);

    return successResponse(res, 'Master financial report compiled', {
      occupancy: {
        totalRooms,
        occupiedRooms: occupiedCount,
        occupancyPercentage: `${occupancyRate}%`
      },
      financials: {
        totalGrossRevenue: Math.round(totalRevenue * 100) / 100,
        totalPaymentsSettled: Math.round(totalCollected * 100) / 100,
        totalBalanceOutstanding: Math.round(totalBalanceDue * 100) / 100
      },
      bookingsCount: bookings.length
    });
  } catch (err) {
    next(err);
  }
};