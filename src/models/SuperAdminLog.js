const mongoose = require('mongoose');

// What the super admin did (create hotel, reset password, open hotel, suspend ...) - audit trail for the owner
const SuperAdminLogSchema = new mongoose.Schema(
 {
    action: { type: String, required: true },
    tenantId: { type: String, default: '', index: true },
    hotelName: { type: String, default: '' },
    detail: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SuperAdminLog', SuperAdminLogSchema);
