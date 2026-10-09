
const { errorResponse } = require('../utils/apiResponse');

const errorHandler = (err, req, res, next) => {
  console.error(`❌ Server Error [${req.method} ${req.url}]:`, err.message || err);

  // Mongoose duplicate key error
  if (err.code === 11000) {
    return errorResponse(res, 'Duplicate field value entered', 400);
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((val) => val.message);
    return errorResponse(res, messages.join(', '), 400);
  }

  return errorResponse(res, err.message || 'Internal Server Error', err.statusCode || 500);
};

module.exports = errorHandler;