const mongoose = require('mongoose');

const RoomTypeSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true, default: 'default' },
    typeId: { type: String },
    name: { type: String, trim: true },
    roomType: { type: String, trim: true },
    roomIds: { type: String }, 
    defaultAdults: { type: Number },
    maxAdults: { type: Number },
    maxChildren: { type: Number },
    minChildAge: { type: Number },
    maxChildAge: { type: Number },
    maxInfant: { type: Number },
    maxInfants: { type: Number },
    minInfantAge: { type: Number },
    maxInfantAge: { type: Number },
    roomMaxOccupancy: { type: Number },
    maxOccupancy: { type: Number },
    basePrice: { type: Number },
    extraAdultPrice: { type: Number },
    extraChildPrice: { type: Number },
    extraInfantPrice: { type: Number },
    photo: { type: String },
    virtual: { type: Boolean },
    isVirtual: { type: Boolean }
  },
  { timestamps: true, strict: false, minimize: false }
);

RoomTypeSchema.index({ tenantId: 1, typeId: 1 });

module.exports = mongoose.model('RoomType', RoomTypeSchema);