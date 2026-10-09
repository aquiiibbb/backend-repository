const Property = require('../models/Property');
const Booking = require('../models/Booking');
const Folio = require('../models/Folio');
const Payment = require('../models/Payment');
const NightAudit = require('../models/NightAudit');
const AuditLog = require('../models/AuditLog');
const { successResponse, errorResponse } = require('../utils/apiResponse');

// @desc    Execute End-of-Day Night Audit & Business Date Roll
// @route   POST /api/night-audit/run
// @access  Private (Manager / SuperAdmin)
exports.runNightAudit = async (req, res, next) => {
  try {
    let property = await Property.findOne({ propertyId: 'prop_main' });
    if (!property) property = await Property.create({ propertyId: 'prop_main' });

    const currentBizDate = property.businessDate || new Date().toISOString().split('T')[0];

    // 1. Fetch all currently checked-in in-house bookings
    const occupiedBookings = await Booking.find({ status: 'Checked In' });

    let totalTariffPosted = 0;
    let totalTaxesPosted = 0;

    // 2. Automatically post Nightly Room Tariff & Taxes to each guest's Folio A
    for (const booking of occupiedBookings) {
      const tariffAmt = booking.ratePerNight || 150;
      const taxRate = property.taxRules.find((t) => t.active)?.ratePercentage || 12;
      const taxAmt = Math.round((tariffAmt * (taxRate / 100)) * 100) / 100;

      let folioA = await Folio.findOne({ bookingId: booking.id, folioType: 'folioA' });
      if (!folioA) folioA = new Folio({ bookingId: booking.id, folioType: 'folioA', items: [] });

      // Post Room Charge
      folioA.items.push({
        id: `rm_chg_${Date.now()}_${booking.id}`,
        date: currentBizDate,
        category: 'Room Charge',
        description: `Nightly Room Tariff - Room ${booking.roomNumber}`,
        amountUSD: tariffAmt,
        amount: tariffAmt,
        quantity: 1,
        isTaxExempt: false,
        taxAmount: taxAmt
      });

      await folioA.save();

      // Update Booking Total & Balance Due
      booking.totalAmount += tariffAmt + taxAmt;
      booking.balanceDue += tariffAmt + taxAmt;
      await booking.save();

      totalTariffPosted += tariffAmt;
      totalTaxesPosted += taxAmt;
    }

    // 3. Roll Business Date forward by 1 day
    const nextDateObj = new Date(currentBizDate);
    nextDateObj.setDate(nextDateObj.getDate() + 1);
    const newBizDate = nextDateObj.toISOString().split('T')[0];

    property.businessDate = newBizDate;
    await property.save();

    // 4. Save Night Audit Snapshot
    const auditRecord = await NightAudit.create({
      auditId: `na_${Date.now()}`,
      businessDateRolled: newBizDate,
      previousBusinessDate: currentBizDate,
      totalRoomsOccupied: occupiedBookings.length,
      totalRoomRevenue: totalTariffPosted,
      totalTaxCollected: totalTaxesPosted,
      executedBy: req.user ? req.user.username : 'Night Auditor'
    });

    // 5. Record System Audit Log
    await AuditLog.create({
      logId: `log_${Date.now()}`,
      action: 'Night Audit Executed',
      details: `Rolled Business Date from ${currentBizDate} to ${newBizDate}. Posted $${totalTariffPosted.toFixed(2)} tariff across ${occupiedBookings.length} rooms.`,
      user: req.user ? req.user.username : 'Night Auditor'
    });

    return successResponse(res, `Night Audit Completed! Business date is now ${newBizDate}`, {
      newBusinessDate: newBizDate,
      occupiedRooms: occupiedBookings.length,
      totalTariffPosted,
      totalTaxesPosted,
      auditRecord
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Get Night Audit Run History
// @route   GET /api/night-audit/history
// @access  Private
exports.getNightAuditHistory = async (req, res, next) => {
  try {
    const history = await NightAudit.find().sort({ createdAt: -1 });
    return successResponse(res, 'Night audit history retrieved', history);
  } catch (err) {
    next(err);
  }
};