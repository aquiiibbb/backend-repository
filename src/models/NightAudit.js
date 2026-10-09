const mongoose = require('mongoose');

const NightAuditSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true, default: 'default' },
    auditId: { type: String, required: true },
    businessDateRolled: { type: String, required: true }, // YYYY-MM-DD
    previousBusinessDate: { type: String, required: true },
    totalRoomsOccupied: { type: Number, default: 0 },
    totalRoomRevenue: { type: Number, default: 0 },
    totalTaxCollected: { type: Number, default: 0 },
    totalPaymentsCollected: { type: Number, default: 0 },
    executedBy: { type: String, default: 'Night Auditor' },
    status: { type: String, enum: ['Completed', 'Failed'], }
  },
  { timestamps: true }
);
NightAuditSchema.index({ tenantId: 1, auditId: 1 }, { unique: true });
module.exports = mongoose.model('NightAudit', NightAuditSchema);