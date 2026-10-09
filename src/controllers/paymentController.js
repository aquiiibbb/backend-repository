const Payment = require('../models/Payment');
const Booking = require('../models/Booking');
const { successResponse, errorResponse } = require('../utils/apiResponse');

// @desc    Post Payment Settlement (Cash, Card, OTA, Direct Bill)
// @route   POST /api/payments
// @access  Private
exports.postPayment = async (req, res, next) => {
  try {
    const { bookingId, amountUSD, method, description } = req.body;

    const amt = Number(amountUSD);
    if (!amt || amt <= 0) return errorResponse(res, 'Valid positive payment amount required', 400);

    const booking = await Booking.findOne({ id: bookingId });
    if (!booking) return errorResponse(res, 'Booking not found', 404);

    const payment = await Payment.create({
      id: `pay_${Date.now()}`,
      bookingId,
      type: 'Payment',
      method: method || 'Cash USD',
      mode: (method || 'Cash').includes('Card') ? 'Card' : 'Cash',
      amountUSD: amt,
      amount: amt,
      description: description || `Payment via ${method || 'Cash'}`,
      isRefund: false,
      date: new Date().toISOString().split('T')[0],
      recordedBy: req.user ? req.user.username : 'Staff'
    });

    // Update Booking Balance Due
    booking.balanceDue = Math.max(0, booking.balanceDue - amt);
    if (booking.balanceDue <= 0.05) {
      booking.paymentStatus = 'Paid';
    } else {
      booking.paymentStatus = 'Partial';
    }
    await booking.save();

    return successResponse(res, 'Payment recorded successfully', { payment, balanceDue: booking.balanceDue });
  } catch (err) {
    next(err);
  }
};

// @desc    Process Payment Refund
// @route   POST /api/payments/refund
// @access  Private (Manager / SuperAdmin)
exports.refundPayment = async (req, res, next) => {
  try {
    const { bookingId, amountUSD, method, description } = req.body;

    const amt = Number(amountUSD);
    if (!amt || amt <= 0) return errorResponse(res, 'Valid positive refund amount required', 400);

    const booking = await Booking.findOne({ id: bookingId });
    if (!booking) return errorResponse(res, 'Booking not found', 404);

    const refund = await Payment.create({
      id: `rfnd_${Date.now()}`,
      bookingId,
      type: 'Refund',
      method: method || 'Cash USD',
      mode: (method || 'Cash').includes('Card') ? 'Card' : 'Cash',
      amountUSD: -Math.abs(amt),
      amount: -Math.abs(amt),
      description: description || `Refund via ${method || 'Cash'}`,
      isRefund: true,
      date: new Date().toISOString().split('T')[0],
      recordedBy: req.user ? req.user.username : 'Staff'
    });

    // Increase Balance Due (Outflow)
    booking.balanceDue += Math.abs(amt);
    await booking.save();

    return successResponse(res, 'Refund processed successfully', { refund, balanceDue: booking.balanceDue });
  } catch (err) {
    next(err);
  }
};