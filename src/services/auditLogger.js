const AuditLog = require('../models/AuditLog');

/**
 * Helper service to record system-wide audit log entries
 */
const recordAuditLog = async (action, details, username = 'System / Staff', ipAddress = '') => {
  try {
    const logId = `log_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    await AuditLog.create({
      logId,
      action,
      details,
      user: username,
      ipAddress
    });
  } catch (err) {
    console.error('❌ Error saving audit log:', err.message);
  }
};

module.exports = { recordAuditLog };