const bcrypt = require('bcryptjs');
const Account = require('../models/Account');
const Tenant = require('../models/Tenant');

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, '');

// Mirror the staff list saved by the frontend (hotelpms_users_v1) into login accounts.
async function syncAccountsFromUsersValue(tenantId, rawValue) {
  let list;
  try {
    list = JSON.parse(rawValue);
  } catch {
    return;
  }
  if (!Array.isArray(list)) return;

  const isDefaultTenant = !!(await Tenant.findOne({ tenantId, isDefault: true }).lean());
  const seen = new Set();
  if (isDefaultTenant) seen.add('admin'); // default admin (admin / admin123) is never removed
  for (const u of list) {
    if (!u || !u.username) continue;
    const username = norm(u.username);
    if (!username) continue;
    seen.add(username);
    if (isDefaultTenant && username === 'admin') continue; // keep admin password fixed

    const existing = await Account.findOne({ tenantId, username });
    const plain = typeof u.password === 'string' ? u.password.trim() : '';
    let passwordHash = existing?.passwordHash || '';
    if (plain) {
      const same = existing?.passwordHash ? await bcrypt.compare(plain, existing.passwordHash) : false;
      if (!same) passwordHash = await bcrypt.hash(plain, 10);
    }
    await Account.updateOne(
      { tenantId, username },
      {
        $set: {
          email: norm(u.email),
          name: u.name || '',
          role: u.role || 'Front Desk Staff',
          status: u.status || 'Active',
          passwordHash,
          localUserId: String(u.id || ''),
        },
      },
      { upsert: true }
    );
  }
  // Staff removed from the list can no longer log in
  await Account.deleteMany({ tenantId, username: { $nin: [...seen] } });
}

async function ensureAdminAccount(tenantId, { username = 'admin', password = 'admin', name = 'System Administrator', email = '' } = {}) {
  const u = norm(username);
  const exists = await Account.findOne({ tenantId, username: u });
  if (exists) return exists;
  return Account.create({
    tenantId,
    username: u,
    email: norm(email),
    name,
    role: 'System Admin',
    status: 'Active',
    passwordHash: await bcrypt.hash(password, 10),
    localUserId: 'usr_admin',
  });
}

module.exports = { syncAccountsFromUsersValue, ensureAdminAccount, norm };
