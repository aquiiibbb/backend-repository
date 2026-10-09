const User = require('../models/User');
const { successResponse, errorResponse } = require('../utils/apiResponse');

// @desc    Get All Staff Users
// @route   GET /api/users
// @access  Private (Manager / SuperAdmin)
exports.getUsers = async (req, res, next) => {
  try {
    const users = await User.find().select('-password');
    return successResponse(res, 'Users retrieved', users);
  } catch (err) {
    next(err);
  }
};

// @desc    Create New Staff Account
// @route   POST /api/users
// @access  Private (Manager / SuperAdmin)
exports.createUser = async (req, res, next) => {
  try {
    const { username, email, password, name, role } = req.body;

    const userExists = await User.findOne({ $or: [{ username }, { email }] });
    if (userExists) {
      return errorResponse(res, 'Username or email already exists', 400);
    }

    const user = await User.create({ username, email, password, name, role });
    return successResponse(res, 'Staff account created successfully', {
      id: user._id,
      username: user.username,
      name: user.name,
      role: user.role
    }, 201);
  } catch (err) {
    next(err);
  }
};

// @desc    Update Staff Role / Active Status
// @route   PUT /api/users/:id
// @access  Private (Manager / SuperAdmin)
exports.updateUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return errorResponse(res, 'User not found', 404);

    const { name, role, active } = req.body;
    if (name) user.name = name;
    if (role) user.role = role;
    if (typeof active === 'boolean') user.active = active;

    await user.save();
    return successResponse(res, 'User updated successfully', user);
  } catch (err) {
    next(err);
  }
};