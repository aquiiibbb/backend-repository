const mongoose = require('mongoose');

// Login accounts (kept in sync with the staff list the frontend maintains in Setup > Users)
const AccountSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    username: { type: String, required: true, lowercase: true, trim: true },
    email: { type: String, default: '', lowercase: true, trim: true },
    name: { type: String, default: '' },
    role: { type: String, default: 'Front Desk Staff' },
    status: { type: String, default: 'Active' },
    passwordHash: { type: String, default: '' },
    localUserId: { type: String, default: '' },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true }
);
AccountSchema.index({ tenantId: 1, username: 1 }, { unique: true });
module.exports = mongoose.model('Account', AccountSchema);
