const Folio = require('../models/Folio');
const Booking = require('../models/Booking');
const { successResponse, errorResponse } = require('../utils/apiResponse');

// @desc    Get Guest Folio Items (Folio A & Folio B)
// @route   GET /api/folios/:bookingId
// @access  Private
exports.getFolio = async (req, res, next) => {
  try {
    const { bookingId } = req.params;
    let folioA = await Folio.findOne({ bookingId, folioType: 'folioA' });
    let folioB = await Folio.findOne({ bookingId, folioType: 'folioB' });

    if (!folioA) folioA = await Folio.create({ bookingId, folioType: 'folioA', items: [] });
    if (!folioB) folioB = await Folio.create({ bookingId, folioType: 'folioB', items: [] });

    return successResponse(res, 'Folio ledger retrieved', { folioA, folioB });
  } catch (err) {
    next(err);
  }
};

// @desc    Post Charge / POS Item to Folio
// @route   POST /api/folios/:bookingId/charge
// @access  Private
exports.postCharge = async (req, res, next) => {
  try {
    const { bookingId } = req.params;
    const { category, description, amountUSD, folioType = 'folioA', isTaxExempt } = req.body;

    const amt = Number(amountUSD);
    if (!amt || amt <= 0) return errorResponse(res, 'Valid positive charge amount required', 400);

    let folio = await Folio.findOne({ bookingId, folioType });
    if (!folio) {
      folio = new Folio({ bookingId, folioType, items: [] });
    }

    const newItem = {
      id: `chg_${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      category: category || 'POS Extra Charge',
      description: description || 'Item Charge',
      amountUSD: amt,
      amount: amt,
      isTaxExempt: Boolean(isTaxExempt)
    };

    folio.items.push(newItem);
    await folio.save();

    // Recalculate Booking Total & Balance Due
    const booking = await Booking.findOne({ id: bookingId });
    if (booking) {
      booking.totalAmount += amt;
      booking.balanceDue += amt;
      await booking.save();
    }

    return successResponse(res, 'Charge posted to folio', { newItem, folio });
  } catch (err) {
    next(err);
  }
};