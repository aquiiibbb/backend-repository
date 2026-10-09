const mongoose = require('mongoose');

const miscTransactionSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      default: 'default',
      index: true
    },
    propertyId: {
      type: mongoose.Schema.Types.Mixed,
      ref: 'Property',
      required: false,
      index: true
    },
    id: {
      type: String,
      index: true
    },
    seqId: {
      type: String,
      required: true // e.g. "MSC-1004"
    },
    date: {
      type: String,
      required: true,
      index: true // Format: YYYY-MM-DD
    },
    time: {
      type: String, // e.g. "05:45 PM"
      default: ''
    },
    type: {
      type: String,
      enum: ['SALE', 'EXPENSE', 'sale', 'expense'],
      required: true,
      index: true
    },
    category: {
      type: String,
      required: true,
      index: true // e.g. "Food & Beverage", "Cleaning Supplies", "Spa & Wellness"
    },
    itemName: {
      type: String,
      required: true // e.g. "Water Bottle", "Plumber Fee"
    },
    amountUSD: {
      type: Number,
      required: true,
      min: 0
    },
    settlement: {
      type: String,
      enum: [
        'Cash',
        'Credit / Debit Card',
        'Online / UPI',
        'Room Charge',
        'Company Card',
        'Bank Transfer',
        'Out-of-Pocket',
        'UPI',
        'Card'
      ],
      default: 'Cash'
    },
    roomNumber: {
      type: String,
      default: 'N/A'
    },
    guestName: {
      type: String,
      default: 'N/A'
    },
    bookingId: {
      type: mongoose.Schema.Types.Mixed,
      ref: 'Booking',
      default: null,
      index: true
    },
    recordedBy: {
      type: mongoose.Schema.Types.Mixed,
      ref: 'User'
    },
    notes: {
      type: String,
      default: ''
    },
    isDeleted: {
      type: Boolean,
      default: false
    }
  },
  { timestamps: true }
);

miscTransactionSchema.index({ tenantId: 1, seqId: 1 });
miscTransactionSchema.index({ tenantId: 1, id: 1 });

module.exports = mongoose.model('MiscTransaction', miscTransactionSchema);
