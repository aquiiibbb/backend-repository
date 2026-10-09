const Tenant = require('../models/Tenant');
const bcrypt = require('bcryptjs');
const Account = require('../models/Account');
const { ensureAdminAccount } = require('./accountService');

// Creates the default hotel + default admin login (admin / admin) on first start.
async function bootstrapDefaultTenant() {
  let tenant = await Tenant.findOne({ isDefault: true });
  if (!tenant) {
    tenant = await Tenant.create({
      tenantId: (process.env.DEFAULT_TENANT_ID || 'default').toLowerCase(),
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
  // Keep the default hotel's admin login fixed: admin / admin123 (active, password always valid)
  await Account.updateOne(
    { tenantId: tenant.tenantId, username: 'admin' },
    { $set: { passwordHash: await bcrypt.hash('admin123', 10), status: 'Active' } }
  );
  return tenant;
}

module.exports = { bootstrapDefaultTenant };
