const Tenant = require('../models/Tenant');
const bcrypt = require('bcryptjs');
const Account = require('../models/Account');
const { ensureAdminAccount } = require('./accountService');

// Creates the default hotel + default admin login (admin / admin) on first start.
async function bootstrapDefaultTenant() {
  try {
    let tenantId = (process.env.DEFAULT_TENANT_ID || 'default').toLowerCase();
    let tenant = await Tenant.findOne({ $or: [{ isDefault: true }, { tenantId }] });
    if (!tenant) {
      tenant = await Tenant.create({
        tenantId,
        name: process.env.DEFAULT_HOTEL_NAME || 'My Hotel',
        status: 'active',
        plan: 'Pro',
        isDefault: true,
      });
      console.log(`🏨 Created default hotel account "${tenant.tenantId}"`);
    }
    await ensureAdminAccount(tenant.tenantId, {
      username: 'admin',
      password: 'admin123',
    });
    await Account.updateOne(
      { tenantId: tenant.tenantId, username: 'admin' },
      { $set: { passwordHash: await bcrypt.hash('admin123', 10), status: 'Active' } }
    );
    return tenant;
  } catch (err) {
    console.error('⚠️ bootstrapDefaultTenant warning:', err.message);
  }
}

module.exports = { bootstrapDefaultTenant };
