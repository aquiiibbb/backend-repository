
/**
 * Standardized API Response Helpers
 */
exports.successResponse = (res, message = 'Success', data = {}, statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data
  });
};

exports.errorResponse = (res, message = 'Error', statusCode = 500, errorDetails = null) => {
  return res.status(statusCode).json({
    success: false,
    message,
    error: errorDetails
  });
};