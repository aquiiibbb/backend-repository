const mongoose = require('mongoose');

const RatePlanSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true, default: 'default' },
    planId: { type: String, required: true },
    name: { type: String, required: true },
    code: { type: String, default: '' },
    description: { type: String, default: '' },
    roomType: { type: String, default: 'All' },
    ratePerNight: { type: Number, default: 0 },
    nights: { type: Number, default: 1 },
    status: { type: String, default: 'Active' },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true, strict: false, minimize: false }
);

RatePlanSchema.index({ tenantId: 1, planId: 1 }, { unique: true });

module.exports = mongoose.model('RatePlan', RatePlanSchema);