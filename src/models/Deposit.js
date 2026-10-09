const mongoose = require('mongoose');

const DepositSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true, default: 'default' },
    id: { type: String, required: true },
    bookingId: { type: String, required: true, index: true },
    amount: { type: Number, required: true },
    amountUSD: { type: Number, required: true },
    mode: { type: String, default: 'Cash' },
    method: { type: String, default: 'Cash' },
    date: { type: String, required: true },
    status: { type: String, enum: ['held', 'applied', 'refunded'], default: 'held' },
    note: { type: String }
  },
  { timestamps: true }
);

DepositSchema.index({ tenantId: 1, id: 1 }, { unique: true });

module.exports = mongoose.model('Deposit', DepositSchema);