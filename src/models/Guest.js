
const mongoose = require('mongoose');

const GuestSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true, default: 'default' },
    guestId: { type: String, required: true },
    guestName: { type: String, required: true },
    email: { type: String, lowercase: true, trim: true },
    phone: String,
    address: String,
    country: { type: String, default: 'United States' },
    idType: { type: String, default: "Passport" },
    idNumber: String,
    vipStatus: { type: Boolean, default: false },
    notes: String,
    // items: { id, title, type, number, country, url, date } (kept as Mixed: a field named "type" made Mongoose treat this as [String])
    scannedDocs: [mongoose.Schema.Types.Mixed]
  },
  { timestamps: true, strict: false, minimize: false }
);

GuestSchema.index({ tenantId: 1, guestId: 1 }, { unique: true });

module.exports = mongoose.model('Guest', GuestSchema);