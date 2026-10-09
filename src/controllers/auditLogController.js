const AuditLog = require('../models/AuditLog');
const { successResponse, errorResponse } = require('../utils/apiResponse');

// @desc    Get All System Audit Logs
// @route   GET /api/audit-logs
// @access  Private (Manager / SuperAdmin)
exports.getAuditLogs = async (req, res, next) => {
  try {
    const { action, user, limit = 100 } = req.query;
    let query = {};

    if (action) query.action = { $regex: action, $options: 'i' };
    if (user) query.user = { $regex: user, $options: 'i' };

    const logs = await AuditLog.find(query)
      .sort({ createdAt: -1 })
      .limit(Number(limit));

    return successResponse(res, 'Audit logs retrieved', logs);
  } catch (err) {
    next(err);
  }
};