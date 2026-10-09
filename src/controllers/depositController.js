const Deposit = require('../models/Deposit');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const { successResponse, errorResponse } = require('../utils/apiResponse');

// @desc    Collect & Hold Security Deposit in Vault
// @route   POST /api/deposits/collect
// @access  Private
exports.collectDeposit = async (req, res, next) => {
  try {
    const { bookingId, amountUSD, mode, note } = req.body;

    const amt = Number(amountUSD);
    if (!amt || amt <= 0) return errorResponse(res, 'Valid positive deposit amount required', 400);

    const booking = await Booking.findOne({ id: bookingId });
    if (!booking) return errorResponse(res, 'Booking not found', 404);

    const deposit = await Deposit.create({
      id: `dep_${Date.now()}`,
      bookingId,
      amount: amt,
      amountUSD: amt,
      mode: mode || 'Cash',
      method: mode || 'Cash',
      date: new Date().toISOString().split('T')[0],
      status: 'held',
      note: note || 'Security Deposit Collected'
    });

    // Recalculate Active Held Sum
    const allHeld = await Deposit.find({ bookingId, status: 'held' });
    const activeHeldSum = allHeld.reduce((sum, d) => sum + d.amountUSD, 0);

    booking.depositAmount = activeHeldSum;
    booking.depositBalance = activeHeldSum;
    booking.depositStatus = 'held';
    booking.securityDepositCollected = activeHeldSum > 0;
    booking.hasDeposit = activeHeldSum > 0;
    await booking.save();

    return successResponse(res, 'Security deposit collected in vault (Status: Held)', { deposit, activeHeldSum });
  } catch (err) {
    next(err);
  }
};

// @desc    Apply Security Deposit as Credit to Folio Balance
// @route   POST /api/deposits/apply
// @access  Private
exports.applyDeposit = async (req, res, next) => {
  try {
    const { bookingId, depositId, amountUSD } = req.body;

    const deposit = await Deposit.findOne({ id: depositId }) || await Deposit.findOne({ bookingId, status: 'held' });
    if (!deposit) return errorResponse(res, 'Held deposit not found', 404);

    const amt = Number(amountUSD || deposit.amountUSD);

    // Update deposit status to 'applied'
    deposit.status = 'applied';
    await deposit.save();

    // Post payment entry credit to folio
    const payment = await Payment.create({
      id: `pay_dep_${Date.now()}`,
      bookingId,
      type: 'Payment',
      method: 'Security Deposit Applied',
      mode: 'Deposit',
      amountUSD: amt,
      amount: amt,
      description: `Applied Security Deposit Credit ($${amt.toFixed(2)})`,
      isRefund: false,
      date: new Date().toISOString().split('T')[0]
    });

    // Recalculate Booking Deposit Status & Balance Due
    const booking = await Booking.findOne({ id: bookingId });
    if (booking) {
      booking.balanceDue = Math.max(0, booking.balanceDue - amt);

      const remainingHeld = await Deposit.find({ bookingId, status: 'held' });
      const activeHeldSum = remainingHeld.reduce((sum, d) => sum + d.amountUSD, 0);

      booking.depositAmount = activeHeldSum;
      booking.depositBalance = activeHeldSum;
      booking.securityDepositCollected = activeHeldSum > 0;
      booking.hasDeposit = activeHeldSum > 0;
      if (activeHeldSum === 0) booking.depositStatus = 'applied';

      await booking.save();
    }

    return successResponse(res, 'Deposit applied to folio balance', { deposit, payment });
  } catch (err) {
    next(err);
  }
};

// @desc    Refund Security Deposit to Guest
// @route   POST /api/deposits/refund
// @access  Private (Manager / SuperAdmin)
exports.refundDeposit = async (req, res, next) => {
  try {
    const { bookingId, depositId, amountUSD, mode } = req.body;

    const deposit = await Deposit.findOne({ id: depositId }) || await Deposit.findOne({ bookingId, status: 'held' });
    if (!deposit) return errorResponse(res, 'Deposit not found', 404);

    const amt = Number(amountUSD || deposit.amountUSD);

    // Update deposit status to 'refunded'
    deposit.status = 'refunded';
    await deposit.save();

    // Recalculate Booking Deposit Status
    const booking = await Booking.findOne({ id: bookingId });
    if (booking) {
      const remainingHeld = await Deposit.find({ bookingId, status: 'held' });
      const activeHeldSum = remainingHeld.reduce((sum, d) => sum + d.amountUSD, 0);

      booking.depositAmount = activeHeldSum;
      booking.depositBalance = activeHeldSum;
      booking.securityDepositCollected = activeHeldSum > 0;
      booking.hasDeposit = activeHeldSum > 0;
      if (activeHeldSum === 0) booking.depositStatus = 'refunded';

      await booking.save();
    }

    return successResponse(res, `Refunded $${amt.toFixed(2)} deposit to guest`, { deposit });
  } catch (err) {
    next(err);
  }
};