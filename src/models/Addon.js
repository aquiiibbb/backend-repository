const mongoose = require('mongoose');
const AddonSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true, default: 'default' },
    addonId: { type: String, required: true },
    name: { type: String, required: true },
    price: { type: Number, default: 0 },
    billingType: { type: String, default: 'Per Night' },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true, strict: false, minimize: false }
);
AddonSchema.index({ tenantId: 1, addonId: 1 }, { unique: true });
module.exports = mongoose.model('Addon', AddonSchema);

