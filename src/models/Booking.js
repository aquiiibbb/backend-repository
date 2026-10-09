const mongoose = require('mongoose');
const BookingSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true, default: 'default' },
    id: { type: String, required: true },
    resCode: { type: String, default: '' },
    guestName: { type: String, required: true },
    guestEmail: { type: String, default: '' },
    guestPhone: { type: String, default: '' },
    nationality: { type: String, default: 'India' },
    idType: { type: String, default: 'Government ID' },
    idNumber: { type: String, default: '' },
    address: { type: String, default: '' },
    roomNumber: { type: String, required: true },
    roomType: { type: String, default: 'Standard' },
    checkInDate: { type: String, required: true },
    checkOutDate: { type: String, required: true },
    nights: { type: Number, default: 1 },
    adults: { type: Number, default: 1 },
    children: { type: Number, default: 0 },
    infants: { type: Number, default: 0 },
    ratePerNight: { type: Number, default: 150 },
    totalAmount: { type: Number, default: 150 },
    balanceDue: { type: Number, default: 150 },
    paymentStatus: { type: String, enum: ['Paid', 'Partial', 'Pending'], default: 'Pending' },
    status: { 
      type: String, 
      enum: ['Confirmed', 'Checked In', 'Checked Out', 'Cancelled', 'No Show'], 
      default: 'Confirmed' 
    },
    bookingSource: { type: String, default: 'Direct / Walk-In' },
    depositAmount: { type: Number, default: 0 },
    depositBalance: { type: Number, default: 0 },
    depositStatus: { type: String, enum: ['held', 'applied', 'refunded', 'none'], default: 'none' },
    securityDepositCollected: { type: Boolean, default: false },
    hasDeposit: { type: Boolean, default: false },
    notes: { type: String, default: '' },
    splitSegments: [mongoose.Schema.Types.Mixed]
  },
  { timestamps: true, strict: false, minimize: false }
);

BookingSchema.index({ tenantId: 1, id: 1 }, { unique: true });
module.exports = mongoose.model('Booking', BookingSchema);
