
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const UserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6, select: false },
    name: { type: String, required: true },
    role: { 
      type: String, 
      enum: ['SuperAdmin', 'Manager', 'FrontDesk', 'Housekeeping'], 
      default: 'FrontDesk' 
    },
    propertyId: { type: String, },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);
// Hash password before save
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});
// Compare password helper
UserSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};
module.exports = mongoose.model('User', UserSchema);