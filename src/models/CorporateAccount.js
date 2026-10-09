const mongoose = require('mongoose');

const CorporateAccountSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true, default: 'default' },
    companyId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    contactPerson: String,
    email: { type: String, lowercase: true, trim: true },
    phone: String,
    creditLimit: { type: Number },
    currentBalanceDue: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);
module.exports = mongoose.model('CorporateAccount', CorporateAccountSchema);