const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true, default: 'default' },
    logId: { type: String, required: true },
    action: { type: String, required: true }, // e.g., 'Security Deposit Refunded', 'Room Tariff Rate Override'
    details: { type: String, required: true },
    user: { type: String, default: 'System / Staff' },
    ipAddress: String,
    timestamp: { type: String, default: () => new Date().toISOString() }
  },
  { timestamps: true, strict: false, minimize: false }
);
AuditLogSchema.index({ tenantId: 1, logId: 1 }, { unique: true });
module.exports = mongoose.model('AuditLog', AuditLogSchema);