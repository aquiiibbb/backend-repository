src/services/nightAuditEngine.js
const Property = require('../models/Property');
const Booking = require('../models/Booking');
const Folio = require('../models/Folio');
const NightAudit = require('../models/NightAudit');
const { recordAuditLog } = require('./auditLogger');
/**
 * Night Audit Core Engine Service
 * Handles business date roll, automated room tariff posting, and tax aggregation
 */

// Execute Nightly Room Tariff & Tax Posting for all checked-in rooms
exports.postNightlyTariffsAndTaxes = async (currentBizDate) => {
  const property = await Property.findOne({ propertyId: 'prop_main' });
  const occupiedBookings = await Booking.find({ status: 'Checked In' });

  let totalTariff = 0;
  let totalTaxes = 0;

  for (const booking of occupiedBookings) {
    const tariffAmt = Number(booking.ratePerNight || 150);
    const taxRate = (property && Array.isArray(property.taxRules))
      ? (property.taxRules.find((t) => t.active)?.ratePercentage || 12)
      : 12;

    const taxAmt = Math.round((tariffAmt * (taxRate / 100)) * 100) / 100;

    let folioA = await Folio.findOne({ bookingId: booking.id, folioType: 'folioA' });
    if (!folioA) {
      folioA = new Folio({ bookingId: booking.id, folioType: 'folioA', items: [] });
    }

    const itemChargeId = `rm_chg_${Date.now()}_${booking.id}`;

    folioA.items.push({
      id: itemChargeId,
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

    // Update Booking Folio Ledger Balances
    booking.totalAmount += tariffAmt + taxAmt;
    booking.balanceDue += tariffAmt + taxAmt;
    await booking.save();

    totalTariff += tariffAmt;
    totalTaxes += taxAmt;
  }

  return {
    occupiedCount: occupiedBookings.length,
    totalTariff,
    totalTaxes
  };
};

// Advance Business Date by 1 Day
exports.advanceBusinessDate = async (currentBizDate) => {
  const dateObj = new Date(currentBizDate);
  dateObj.setDate(dateObj.getDate() + 1);
  const newDateString = dateObj.toISOString().split('T')[0];

  let property = await Property.findOne({ propertyId: 'prop_main' });
  if (!property) property = new Property({ propertyId: 'prop_main' });

  property.businessDate = newDateString;
  await property.save();

  return newDateString;
};

// Complete Night Audit Process
exports.executeFullNightAudit = async (username = 'Night Auditor') => {
  let property = await Property.findOne({ propertyId: 'prop_main' });
  if (!property) property = await Property.create({ propertyId: 'prop_main' });

  const currentBizDate = property.businessDate || new Date().toISOString().split('T')[0];

  // 1. Post Tariffs & Taxes
  const summary = await exports.postNightlyTariffsAndTaxes(currentBizDate);

  // 2. Roll Date
  const newDate = await exports.advanceBusinessDate(currentBizDate);

  // 3. Save Snapshot
  const auditRecord = await NightAudit.create({
    auditId: `na_${Date.now()}`,
    businessDateRolled: newDate,
    previousBusinessDate: currentBizDate,
    totalRoomsOccupied: summary.occupiedCount,
    totalRoomRevenue: summary.totalTariff,
    totalTaxCollected: summary.totalTaxes,
    executedBy: username
  });

  // 4. Record Audit Log
  await recordAuditLog(
    'Night Audit Completed',
    `Rolled business date from ${currentBizDate} to ${newDate}. Posted $${summary.totalTariff.toFixed(2)} tariff across ${summary.occupiedCount} rooms.`,
    username
  );

  return {
    success: true,
    previousDate: currentBizDate,
    newBusinessDate: newDate,
    summary,
    auditRecord
  };
};