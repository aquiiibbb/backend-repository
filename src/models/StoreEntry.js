const mongoose = require('mongoose');
// One document per (tenant, browser-storage key). `value` is the exact string the frontend keeps in localStorage.
const StoreEntrySchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    key: { type: String, required: true },
    value: { type: String, default: '' },
    rev: { type: Number, default: 1 },
    // Only used for the bookings list: JSON string of { bookingId: rev it first appeared at } (for safe multi-PC merging).
    // Kept as a string so booking ids containing "." or "$" can never break MongoDB field names.
    idRev: { type: String, default: undefined },
  },
  { timestamps: true, minimize: false }
);
StoreEntrySchema.index({ tenantId: 1, key: 1 }, { unique: true });
module.exports = mongoose.model('StoreEntry', StoreEntrySchema);
