const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { successResponse, errorResponse } = require('../utils/apiResponse');

// Generate JWT Helper Token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'super_secret_pms_jwt_key_2026_change_in_production', {
    expiresIn: '7d'
  });
};

// @desc    Staff Login
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return errorResponse(res, 'Please provide username and password', 400);
    }

    // Check user exists (select password explicitly)
    const user = await User.findOne({ username }).select('+password');
    if (!user) {
      return errorResponse(res, 'Invalid credentials', 401);
    }

    if (!user.active) {
      return errorResponse(res, 'Account is deactivated. Contact Manager.', 403);
    }

    // Compare password
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return errorResponse(res, 'Invalid credentials', 401);
    }

    const token = generateToken(user._id);

    return successResponse(res, 'Login successful', {
      token,
      user: {
        id: user._id,
        username: user.username,
        name: user.name,
        email: user.email,
        role: user.role,
        propertyId: user.propertyId
      }
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Get Current Logged In Staff Profile
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    return successResponse(res, 'Profile retrieved', user);
  } catch (err) {
    next(err);
  }
};

// @desc    Logout Staff User
// @route   POST /api/auth/logout
// @access  Private
exports.logout = async (req, res) => {
  return successResponse(res, 'Logged out successfully');
};