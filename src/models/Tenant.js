const mongoose = require('mongoose');
const TenantSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, unique: true, lowercase: true, trim: true },
    hotelCode: { type: String, index: true, trim: true },
    name: { type: String, required: true, trim: true },
    ownerName: { type: String, default: '' },
    ownerEmail: { type: String, default: '', lowercase: true, trim: true },
    phone: { type: String, default: '' },
    currency: { type: String, default: '$' },
    plan: { type: String, default: 'Pro' },
    maxRooms: { type: Number, default: 50 },
    status: { type: String, enum: ['active', 'trialing', 'suspended', 'canceled'], default: 'active' },
    notes: { type: String, default: '' },
    subscriptionEnd: { type: Date, default: null },
    // how many guest / staff emails this hotel may send per day through the Ahaalo email service (protects the sender reputation)
    emailDailyLimit: { type: Number, },
    emailEnabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

TenantSchema.pre('validate', async function () {
  if (!this.hotelCode || !/^\d{4}$/.test(this.hotelCode)) {
    let code = '';
    let exists = true;
    let attempts = 0;
    while (exists && attempts < 500) {
      attempts += 1;
      code = String(Math.floor(1000 + Math.random() * 9000));
      exists = await this.constructor.exists({ hotelCode: code });
    }
    this.hotelCode = code;
  }
});

module.exports = mongoose.model('Tenant', TenantSchema);
