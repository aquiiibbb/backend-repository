const mongoose = require('mongoose');
const FolioSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    bookingId: { type: String, required: true, index: true },
    folioType: { type: String, enum: ['folioA', 'folioB'], default: 'folioA' },
    items: [
      {
        id: { type: String, required: true },
        date: { type: String, required: true },
        category: { type: String, required: true }, // 'Room Charge', 'POS Charge', 'Discount / Adjustment'
        description: { type: String, required: true },
        amountUSD: { type: Number, required: true },
        amount: { type: Number, required: true },
        quantity: { type: Number, default: 1 },
        isTaxExempt: { type: Boolean, default: false },
        isDiscount: { type: Boolean, default: false },
        taxAmount: { type: Number, default: 0 }
      }
    ]
  },
  { timestamps: true }
);


module.exports = mongoose.model('Folio', FolioSchema);