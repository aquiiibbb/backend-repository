
const mongoose = require('mongoose');
const PaymentSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true, default: 'default' },
    id: { type: String, required: true },
    bookingId: { type: String, required: true, index: true },
    type: { type: String, enum: ['Payment', 'Refund'], default: 'Payment' },
    method: { type: String, required: true }, // 'Cash USD', 'Credit Card', 'OTA Collect', 'Direct Bill'
    mode: { type: String, default: 'Cash' },
    amountUSD: { type: Number, required: true }, // Positive for payment, Negative for refund
    amount: { type: Number, required: true },
    description: String,
    reference: String,
    isRefund: { type: Boolean, default: false },
    date: { type: String, required: true },
    recordedBy: { type: String, default: 'System' }
  },
  { timestamps: true }
);

PaymentSchema.index({ tenantId: 1, id: 1 }, { unique: true });

module.exports = mongoose.model('Payment', PaymentSchema);