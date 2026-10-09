const mongoose = require('mongoose');
const TaxRuleSchema = new mongoose.Schema(  {
    tenantId: { type: String, required: true, index: true, default: 'default' },
    taxId: { type: String, required: true },
    name: { type: String, required: true },
    code: { type: String, default: '' },
    taxType: { type: String, default: 'percentage' },
    percent: { type: Number, default: 0 },
    fixedAmount: { type: Number }
  },
  
  { timestamps: true, strict: false, minimize: false }

);
TaxRuleSchema.index({ tenantId: 1, taxId: 1 }, { unique: true });
module.exports = mongoose.model('TaxRule', TaxRuleSchema);