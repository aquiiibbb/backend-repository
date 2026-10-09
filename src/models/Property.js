const mongoose = require('mongoose');

const PropertySchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true, default: 'default' },
    // Basic Details
    propertyName: {
      type: String,
      required: true,
      trim: true
    },
    propertyWebsite: {
      type: String,
      trim: true
    },
    taxIdentificationNumber: {
      type: String,
      trim: true
    },
    totalRoomCount: {
      type: Number,
      default: 0,
      min: 0
    },
    contactName: {
      type: String,
      trim: true
    },
    currency: {
      code: { type: String, default: 'USD' },
      symbol: { type: String, default: '$' }
    },
    phone: {
      countryCode: { type: String, default: 'US' },
      dialCode: { type: String, default: '+1' },
      number: { type: String, trim: true }
    },
    email: {
      type: String,
      trim: true,
      lowercase: true
    },

    // Night Audit Scheduled Time & Business Date Rollover
    nightAudit: {
      scheduledTime: {
        type: String, // 24-hour format (e.g. "02:00")
        default: '02:00'
      },
      automatedAuditPopupPrompt: {
        type: Boolean,
        default: true
      }
    },

    // Address & Location Details
    location: {
      country: { type: String, trim: true },
      state: { type: String, trim: true },
      city: { type: String, trim: true },
      address: { type: String, trim: true },
      zipCode: { type: String, trim: true },
      latitude: { type: Number },
      longitude: { type: Number }
    },

    // Rating & Branding
    rating: {
      type: Number,
      min: 1,
      max: 5,
      default: 5
    },
    logoUrl: {
      type: String,
      default: ''
    }
  },
  { timestamps: true, strict: false, minimize: false }
);


module.exports = mongoose.model('Property', PropertySchema);