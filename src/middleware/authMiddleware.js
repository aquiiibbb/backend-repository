const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { errorResponse } = require('../utils/apiResponse');

const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return errorResponse(res, 'Not authorized, token missing', 401);
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'super_secret_pms_jwt_key_2026_change_in_production');
    req.user = await User.findById(decoded.id).select('-password');
    if (!req.user || !req.user.active) {
      return errorResponse(res, 'User account is inactive or deleted', 401);
    }
    next();
  } catch (err) {
    return errorResponse(res, 'Token verification failed or expired', 401);
  }
};

module.exports = { protect };