const mongoose = require('mongoose');

// Every email the system tried to send (guest mails, staff alerts, login details). Used for the daily limit,
// to never send the same booking mail twice, and so the super admin can see what went out.
const EmailLogSchema = new mongoose.Schema(
  {
    tenantId: { type: String, default: '', index: true },
    type: { type: String, required: true }, // confirmation | checkIn | checkOut | cancellation | preArrival | alert_* | credentials | test
    bookingId: { type: String, default: '' },
    to: { type: String, default: '' },
    subject: { type: String, default: '' },
    status: { type: String, enum: ['sent', 'failed'], required: true },
    error: { type: String, default: '' },
    messageId: { type: String },
  },
  { timestamps: true }
);

EmailLogSchema.index({ tenantId: 1, type: 1, bookingId: 1, status: 1 });
EmailLogSchema.index({ tenantId: 1, createdAt: -1 });

module.exports = mongoose.model('EmailLog', EmailLogSchema);
