const mongoose = require('mongoose');

const RoomSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true, default: 'default' },
    roomNumber: { type: String, required: true },
    roomType: { type: String, required: true, default: 'Standard' },
    floor: { type: Number, default: 1 },
    ratePerNight: { type: Number, default: 0 },
    housekeepingStatus: { 
      type: String, 
      enum: ['Clean', 'Dirty', 'Inspected', 'Out of Service', 'Maintenance']
    },
    foStatus: { type: String, enum: ['Vacant', 'Occupied', 'Reserved'] },
    isClean: { type: Boolean, default: true },
    petFriendly: { type: Boolean, default: false },
    nonSmoking: { type: Boolean, default: true },
    isBlocked: { type: Boolean, default: false },
    blockReason: { type: String, default: '' }
  },
  { timestamps: true, strict: false, minimize: false }
);

RoomSchema.index({ tenantId: 1, roomNumber: 1 }, { unique: true });

module.exports = mongoose.model('Room', RoomSchema);