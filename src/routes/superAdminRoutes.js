const express = require('express');
const crypto = require('crypto');
const Tenant = require('../models/Tenant');
const Account = require('../models/Account');
const StoreEntry = require('../models/StoreEntry');
const SuperAdminLog = require('../models/SuperAdminLog');
const Booking = require('../models/Booking');
const Room = require('../models/Room');
const RoomType = require('../models/RoomType');
const Property = require('../models/Property');
const AuditLog = require('../models/AuditLog');
const emailService = require('../services/emailService');
const EmailLog = require('../models/EmailLog');
const { requireSuperAdmin, signSuperAdminToken, signImpersonationToken, rateLimit } = require('../middleware/tenantAuth');
const { ensureAdminAccount, norm } = require('../services/accountService');
const store = require('../services/storeService');
const { ALL_YES_RIGHTS } = require('../config/rights');
const { USERS_KEY } = require('../config/storeKeys');

const router = express.Router();
const PLAN_PRICE = { Starter: 49, Pro: 99, Enterprise: 199 };

const safeEq = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

router.post('/login', rateLimit({ max: 10 }), (req, res) => {
  const u = process.env.SUPERADMIN_USERNAME || 'superadmin';
  const p = process.env.SUPERADMIN_PASSWORD || 'admin123';
  const { username, password } = req.body || {};
  if (safeEq(username || '', u) && safeEq(password || '', p)) {
    return res.json({ token: signSuperAdminToken(u), user: { username: u, name: 'Super Admin', role: 'SuperAdmin' } });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

router.use(requireSuperAdmin);
router.use('/data', require('./superAdminDataRoutes'));


// Address of the HOTEL app (where owners log in); used in the login e-mail
const hotelLoginUrl = () => `${String(process.env.HOTEL_APP_URL || 'http://app.ahaalo.com').replace(/\/+$/, '')}/login`;

// Sends the login details straight to the owner's e-mail. Never throws: the panel still shows the details if mail fails.
async function mailCredentials(tenant, creds, isReset = false) {
  try {
    let hotelCode = creds.hotelCode || tenant.hotelCode;
    if (!/^\d{4}$/.test(String(hotelCode || ''))) {
      hotelCode = await genUniqueHotelCode();
      if (tenant._id) await Tenant.updateOne({ _id: tenant._id }, { $set: { hotelCode } });
      tenant.hotelCode = hotelCode;
    }
    const r = await emailService.sendCredentialsEmail({
      tenantId: tenant.tenantId, hotelCode, to: tenant.ownerEmail, hotelName: tenant.name, ownerName: tenant.ownerName,
      username: creds.username, email: creds.email, password: creds.password, loginUrl: hotelLoginUrl(), isReset,
    });
    return { sent: r.ok, to: tenant.ownerEmail, error: r.ok ? '' : r.error || 'Email could not be sent' };
  } catch (e) {
    return { sent: false, to: tenant.ownerEmail, error: String(e.message).slice(0, 200) };
  }
}

const log = (action, tenant, detail = '') =>
  SuperAdminLog.create({ action, tenantId: tenant?.tenantId || '', hotelName: tenant?.name || '', detail }).catch(() => {});

// The owner logs in with this email, so it must belong to one hotel only
async function emailTaken(email, exceptTenantId) {
  const e = norm(email);
  if (!e) return false;
  const tenants = await Tenant.find({}, 'tenantId ownerEmail').lean();
  if (tenants.some((t) => t.tenantId !== exceptTenantId && norm(t.ownerEmail) === e)) return true;
  const acc = await Account.findOne({ email: e, ...(exceptTenantId ? { tenantId: { $ne: exceptTenantId } } : {}) }).lean();
  return !!acc;
}

const genPassword = () => {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = crypto.randomBytes(10);
  for (let i = 0; i < 10; i += 1) out += chars[bytes[i] % chars.length];
  return out;
};

async function genUniqueHotelCode() {
  let code = '';
  let exists = true;
  let attempts = 0;
  while (exists && attempts < 500) {
    attempts += 1;
    code = String(Math.floor(1000 + Math.random() * 9000));
    exists = await Tenant.exists({ hotelCode: code });
  }
  return code;
}

async function ensureHotelCodes(tenants) {
  for (const t of tenants) {
    if (!t.hotelCode || !/^\d{4}$/.test(t.hotelCode)) {
      const code = await genUniqueHotelCode();
      await Tenant.updateOne({ _id: t._id }, { $set: { hotelCode: code } });
      t.hotelCode = code;
    }
  }
  return tenants;
}

// Storage size per hotel (nice-to-have: if the database can't compute it, only the size is skipped)
async function storageBySize() {
  try {
    return await StoreEntry.aggregate([{ $group: { _id: '$tenantId', bytes: { $sum: { $strLenBytes: { $ifNull: ['$value', ''] } } } } }]);
  } catch {
    return [];
  }
}

// Per hotel numbers (from the hotel's own rows only)
async function metricsByTenant() {
  const [rooms, roomTypes, bookingAgg, bookingAmt, accounts, entries, sizes] = await Promise.all([
    Room.aggregate([{ $group: { _id: '$tenantId', n: { $sum: 1 } } }]),
    RoomType.aggregate([{ $group: { _id: '$tenantId', n: { $sum: 1 } } }]),
    Booking.aggregate([{ $group: { _id: { t: '$tenantId', s: '$status' }, n: { $sum: 1 } } }]),
    Booking.aggregate([{ $group: { _id: { t: '$tenantId', s: '$status' }, amount: { $sum: '$totalAmount' } } }]),
    Account.find({}, 'tenantId lastLoginAt').lean(),
    StoreEntry.find({}, 'tenantId updatedAt').lean(), // no values -> light
    storageBySize(),
  ]);
  const m = {};
  const get = (t) => (m[t] = m[t] || { rooms: 0, roomTypes: 0, bookings: 0, checkedIn: 0, upcoming: 0, cancelled: 0, bookingValue: 0, staff: 0, lastLoginAt: null, lastActivityAt: null, storageKB: 0 });
  const later = (a, b) => (!a || (b && new Date(b) > new Date(a)) ? b || a : a);
  rooms.forEach((r) => (get(r._id).rooms = r.n));
  roomTypes.forEach((r) => (get(r._id).roomTypes = r.n));
  bookingAgg.forEach((r) => {
    const x = get(r._id.t);
    x.bookings += r.n;
    if (r._id.s === 'Checked In') x.checkedIn = r.n;
    if (r._id.s === 'Confirmed') x.upcoming = r.n;
    if (r._id.s === 'Cancelled' || r._id.s === 'No Show') x.cancelled += r.n;
  });
  bookingAmt.forEach((r) => {
    if (r._id.s !== 'Cancelled' && r._id.s !== 'No Show') get(r._id.t).bookingValue += r.amount || 0;
  });
  accounts.forEach((a) => {
    const x = get(a.tenantId);
    x.staff += 1;
    x.lastLoginAt = later(x.lastLoginAt, a.lastLoginAt);
  });
  entries.forEach((e) => {
    const x = get(e.tenantId);
    x.lastActivityAt = later(x.lastActivityAt, e.updatedAt);
  });
  sizes.forEach((r) => (get(r._id).storageKB = Math.round((r.bytes || 0) / 1024)));
  return m;
}

router.get('/stats', async (req, res, next) => {
  try {
    const [tenants, m] = await Promise.all([Tenant.find().lean(), metricsByTenant()]);
    const live = tenants.filter((t) => t.status === 'active' || t.status === 'trialing');
    const sum = (f) => tenants.reduce((a, t) => a + (m[t.tenantId]?.[f] || 0), 0);
    res.json({
      totalTenants: tenants.length,
      activeTenants: tenants.filter((t) => t.status === 'active').length,
      trialingTenants: tenants.filter((t) => t.status === 'trialing').length,
      suspendedTenants: tenants.filter((t) => t.status === 'suspended').length,
      canceledTenants: tenants.filter((t) => t.status === 'canceled').length,
      mrr: tenants.filter((t) => t.status === 'active').reduce((s, t) => s + (PLAN_PRICE[t.plan] || 0), 0),
      totalRoomsCount: sum('rooms'),
      totalBookings: sum('bookings'),
      checkedInNow: sum('checkedIn'),
      totalStaff: sum('staff'),
      expiringSoon: live.filter((t) => t.subscriptionEnd && new Date(t.subscriptionEnd) - Date.now() < 7 * 86400000).length,
    });
  } catch (err) {
    next(err);
  }
});

// Every hotel + its live numbers (one call for the whole directory)
router.get('/tenants', async (req, res, next) => {
  try {
    const tenantsDocs = await Tenant.find().sort({ createdAt: -1 });
    let tenants = tenantsDocs.map((t) => t.toObject());
    await ensureHotelCodes(tenants);
    const m = await metricsByTenant();
    res.json(tenants.map((t) => ({ ...t, metrics: m[t.tenantId] || { rooms: 0, roomTypes: 0, bookings: 0, checkedIn: 0, upcoming: 0, cancelled: 0, bookingValue: 0, staff: 0, lastLoginAt: null, lastActivityAt: null, storageKB: 0 } })));
  } catch (err) {
    next(err);
  }
});

// Full picture of one hotel
router.get('/tenants/:id/detail', async (req, res, next) => {
  try {
    const tDoc = await Tenant.findById(req.params.id);
    if (!tDoc) return res.status(404).json({ error: 'Hotel account not found' });
    let t = tDoc.toObject();
    if (!t.hotelCode || !/^\d{4}$/.test(t.hotelCode)) {
      const code = await genUniqueHotelCode();
      await Tenant.updateOne({ _id: tDoc._id }, { $set: { hotelCode: code } });
      t.hotelCode = code;
    }
    const tid = t.tenantId;
    const [m, accounts, roomTypes, rooms, property, recentBookings, logs] = await Promise.all([
      metricsByTenant(),
      Account.find({ tenantId: tid }).sort({ createdAt: 1 }).lean(),
      RoomType.find({ tenantId: tid }).lean(),
      Room.find({ tenantId: tid }).sort({ roomNumber: 1 }).lean(),
      Property.findOne({ tenantId: tid }).lean(),
      Booking.find({ tenantId: tid }).sort({ updatedAt: -1 }).limit(15).lean(),
      AuditLog.find({ tenantId: tid }).sort({ createdAt: -1 }).limit(20).lean(),
    ]);
    res.json({
      tenant: t,
      metrics: m[tid] || {},
      staff: accounts.map((a) => ({ username: a.username, name: a.name, email: a.email, role: a.role, status: a.status, lastLoginAt: a.lastLoginAt, createdAt: a.createdAt })),
      roomTypes: roomTypes.map((r) => ({ name: r.name || r.roomType, roomIds: r.roomIds, maxOccupancy: r.maxOccupancy })),
      rooms: rooms.map((r) => ({ roomNumber: r.roomNumber, roomType: r.roomType, floor: r.floor, status: r.foStatus || r.status, housekeeping: r.housekeepingStatus })),
      property: property ? { propertyName: property.propertyName, email: property.email, website: property.propertyWebsite, phone: property.phone, location: property.location, currency: property.currency } : null,
      recentBookings: recentBookings.map((b) => ({ id: b.id, guestName: b.guestName, roomNumber: b.roomNumber, checkInDate: b.checkInDate, checkOutDate: b.checkOutDate, status: b.status, totalAmount: b.totalAmount })),
      activity: logs.map((l) => ({ action: l.action, details: l.details, user: l.user, timestamp: l.timestamp })),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/tenants', async (req, res, next) => {
  try {
    const { name, ownerName, ownerEmail, phone, currency, plan, maxRooms, subscriptionEnd } = req.body || {};
    let { password } = req.body || {};
    if (!name || !ownerEmail) return res.status(400).json({ error: 'Hotel name and owner email are required' });
    if (await emailTaken(ownerEmail)) return res.status(409).json({ error: `The email ${ownerEmail} is already used by another hotel. Use a different email for this hotel.` });
    password = String(password || '').trim() || genPassword();
    if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

    const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'hotel';
    let tenantId = slug;
    while (await Tenant.exists({ tenantId })) tenantId = `${slug}-${crypto.randomBytes(2).toString('hex')}`;

    const hotelCode = await genUniqueHotelCode();

    const tenant = await Tenant.create({
      tenantId, hotelCode, name, ownerName, ownerEmail, phone,
      currency: currency || '$', plan: plan || 'Pro', maxRooms: Number(maxRooms) || 50, status: 'trialing',
      subscriptionEnd: subscriptionEnd ? new Date(subscriptionEnd) : null,
    });

    // Seed the hotel's staff list (so the frontend's login screen finds the owner) + the matching login account
    const adminUser = {
      id: 'usr_admin', username: 'admin', password, name: ownerName || 'Hotel Admin',
      email: String(ownerEmail).toLowerCase(), role: 'System Admin', status: 'Active', rights: { ...ALL_YES_RIGHTS },
    };
    await store.writeKey(tenantId, USERS_KEY, JSON.stringify([adminUser]));
    await ensureAdminAccount(tenantId, { username: 'admin', password, name: ownerName || name, email: ownerEmail });
    // A hotel with no saved room list would show 50 demo rooms - save an empty list so the new hotel starts completely blank
    await store.writeKey(tenantId, 'hotelpms_room_numbers_v3', '[]');
    const initialHotelInfo = {
      name: tenant.name,
      website: '',
      taxId: '',
      totalRooms: String(tenant.maxRooms || 50),
      contactName: tenant.ownerName || 'Hotel Admin',
      currency: tenant.currency || 'US Dollar ($)',
      phone: tenant.phone || '',
      email: tenant.ownerEmail || '',
      city: '',
      state: '',
      country: '',
      address: '',
      zipcode: '',
      rating: 5,
      logoUrl: '',
      logo: '',
      checkInTime: '15:00',
      checkOutTime: '11:00',
    };
    await store.writeKey(tenantId, 'hotelpms_hotel_info_v3', JSON.stringify(initialHotelInfo));
    await ensureAdminAccount(tenantId, { username: 'admin', password, name: adminUser.name, email: adminUser.email });
    log('Hotel created', tenant, `owner: ${ownerEmail}, plan: ${tenant.plan}`);

    const adminCredentials = { hotelCode, hotelId: tenantId, username: 'admin', email: adminUser.email, password, loginUrl: '/login' };
    const mail = await mailCredentials(tenant, adminCredentials);
    log(mail.sent ? 'Login emailed to owner' : 'Login email failed', tenant, `${mail.to}${mail.error ? ` - ${mail.error}` : ''}`);
    res.status(201).json({ tenant, adminCredentials, email: mail });
  } catch (err) {
    next(err);
  }
});

router.put('/tenants/:id', async (req, res, next) => {
  try {
    const allowed = ['status', 'plan', 'maxRooms', 'notes', 'name', 'ownerName', 'ownerEmail', 'phone', 'currency', 'subscriptionEnd', 'emailDailyLimit', 'emailEnabled'];
    const patch = {};
    for (const k of allowed) {
      if (req.body[k] === undefined) continue;
      if (k === 'maxRooms') patch[k] = Number(req.body[k]) || 50;
      else if (k === 'emailDailyLimit') patch[k] = Math.max(0, Math.min(5000, Number(req.body[k]) || 0));
      else if (k === 'emailEnabled') patch[k] = req.body[k] === true || req.body[k] === 'true';
      else if (k === 'subscriptionEnd') patch[k] = req.body[k] ? new Date(req.body[k]) : null;
      else patch[k] = req.body[k];
    }
    const before = await Tenant.findById(req.params.id).lean();
    if (before?.isDefault && patch.status && !['active', 'trialing'].includes(patch.status)) {
      return res.status(400).json({ error: 'The default hotel account cannot be suspended or canceled' });
    }
    if (patch.ownerEmail && before && norm(patch.ownerEmail) !== norm(before.ownerEmail) && (await emailTaken(patch.ownerEmail, before.tenantId))) {
      return res.status(409).json({ error: `The email ${patch.ownerEmail} is already used by another hotel.` });
    }
    const t = await Tenant.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true, runValidators: true });
    if (!t) return res.status(404).json({ error: 'Hotel account not found' });
    if (patch.ownerEmail && before && norm(patch.ownerEmail) !== norm(before.ownerEmail) && !t.isDefault) {
      // the owner's login email = the "admin" user of this hotel
      const entry = await StoreEntry.findOne({ tenantId: t.tenantId, key: USERS_KEY }).lean();
      let list = [];
      try { list = JSON.parse(entry?.value || '[]'); } catch { list = []; }
      if (Array.isArray(list) && list.some((u) => norm(u?.username) === 'admin')) {
        list = list.map((u) => (norm(u?.username) === 'admin' ? { ...u, email: String(patch.ownerEmail).toLowerCase() } : u));
        await store.writeKey(t.tenantId, USERS_KEY, JSON.stringify(list));
      }
    }
    log('Hotel updated', t, Object.keys(patch).map((k) => `${k}=${patch[k]}`).join(', '));
    res.json(t);
  } catch (err) {
    next(err);
  }
});

// "Deactivate": soft - data is kept, login is blocked (can be re-activated from Edit)
router.delete('/tenants/:id', async (req, res, next) => {
  try {
    const t = await Tenant.findById(req.params.id);
    if (!t) return res.status(404).json({ error: 'Hotel account not found' });
    if (t.isDefault) return res.status(400).json({ error: 'The default hotel account cannot be deactivated' });
    t.status = 'canceled';
    await t.save();
    log('Hotel deactivated', t);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Permanent delete of the hotel and ALL its data (owner must type the hotel name)
router.post('/tenants/:id/purge', async (req, res, next) => {
  try {
    const t = await Tenant.findById(req.params.id);
    if (!t) return res.status(404).json({ error: 'Hotel account not found' });
    if (t.isDefault) return res.status(400).json({ error: 'The default hotel account cannot be deleted' });
    if (String(req.body?.confirmName || '').trim() !== t.name) return res.status(400).json({ error: 'Hotel name does not match. Nothing was deleted.' });
    const tid = t.tenantId;
    const names = ['Addon', 'AuditLog', 'Booking', 'Deposit', 'Guest', 'NightAudit', 'Payment', 'Property', 'RatePlan', 'Room', 'RoomType', 'TaxRule', 'Folio', 'CorporateAccount'];
    for (const n of names) await require(`../models/${n}`).deleteMany({ tenantId: tid });
    await StoreEntry.deleteMany({ tenantId: tid });
    await EmailLog.deleteMany({ tenantId: tid });
    await Account.deleteMany({ tenantId: tid });
    await Tenant.deleteOne({ _id: t._id });
    log('Hotel deleted permanently', t, `id: ${tid}`);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// New password for a hotel login (default: the owner "admin"); the password is shown once so it can be sent to the owner
router.post('/tenants/:id/reset-password', async (req, res, next) => {
  try {
    const t = await Tenant.findById(req.params.id).lean();
    if (!t) return res.status(404).json({ error: 'Hotel account not found' });
    const username = norm(req.body?.username || 'admin');
    if (t.isDefault && username === 'admin') return res.status(400).json({ error: 'The default hotel admin password is fixed (admin / admin123).' });
    const password = String(req.body?.password || '').trim() || genPassword();
    if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

    const entry = await StoreEntry.findOne({ tenantId: t.tenantId, key: USERS_KEY }).lean();
    let list = [];
    try { list = JSON.parse(entry?.value || '[]'); } catch { list = []; }
    if (!Array.isArray(list)) list = [];
    const idx = list.findIndex((u) => norm(u?.username) === username);
    if (idx < 0) {
      const acc = await Account.findOne({ tenantId: t.tenantId, username });
      if (!acc) return res.status(404).json({ error: `User "${username}" not found in this hotel` });
      list.push({ id: acc.localUserId || `usr_${username}`, username, name: acc.name, email: acc.email, role: acc.role, status: acc.status || 'Active', password });
    } else {
      list[idx] = { ...list[idx], password, status: list[idx].status || 'Active' };
    }
    // writeKey also refreshes the login accounts + the hotel's open sessions pick it up on their next sync
    await store.writeKey(t.tenantId, USERS_KEY, JSON.stringify(list));
    log('Password reset', t, `user: ${username}`);
    const acc = await Account.findOne({ tenantId: t.tenantId, username }).lean();
    let hotelCode = t.hotelCode;
    if (!hotelCode || !/^\d{4}$/.test(hotelCode)) {
      hotelCode = await genUniqueHotelCode();
      await Tenant.updateOne({ _id: t._id }, { $set: { hotelCode } });
    }
    const credentials = { hotelCode, hotelId: t.tenantId, username, email: acc?.email || t.ownerEmail, password, loginUrl: '/login' };
    // the new password goes to the hotel's owner e-mail (not to a staff member's own address)
    const mail = req.body?.sendEmail === false ? { sent: false, to: t.ownerEmail, error: 'Not requested' } : await mailCredentials({ ...t, hotelCode }, credentials, true);
    if (req.body?.sendEmail !== false) log(mail.sent ? 'New password emailed to owner' : 'Password email failed', t, `${mail.to}${mail.error ? ` - ${mail.error}` : ''}`);
    res.json({ credentials, email: mail });
  } catch (err) {
    next(err);
  }
});


// Is the Ahaalo email service (AWS SES) set up on the server?
router.get('/email/status', (req, res) => res.json({ configured: emailService.platformConfigured(), from: process.env.AWS_SES_FROM_EMAIL || '' }));

// Recent e-mails of one hotel (what went out, what failed)
router.get('/tenants/:id/emails', async (req, res, next) => {
  try {
    const t = await Tenant.findById(req.params.id).lean();
    if (!t) return res.status(404).json({ error: 'Hotel account not found' });
    const since = new Date(); since.setUTCHours(0, 0, 0, 0);
    const [rows, today, total, failed] = await Promise.all([
      EmailLog.find({ tenantId: t.tenantId }).sort({ createdAt: -1 }).limit(50).lean(),
      EmailLog.countDocuments({ tenantId: t.tenantId, status: 'sent', createdAt: { $gte: since } }),
      EmailLog.countDocuments({ tenantId: t.tenantId, status: 'sent' }),
      EmailLog.countDocuments({ tenantId: t.tenantId, status: 'failed' }),
    ]);
    res.json({ today, total, failed, limit: t.emailDailyLimit ?? 300, enabled: t.emailEnabled !== false, rows: rows.map((r) => ({ type: r.type, to: r.to, subject: r.subject, status: r.status, error: r.error, bookingId: r.bookingId, createdAt: r.createdAt })) });
  } catch (err) { next(err); }
});

// Whole hotel as one JSON file (backup / hand-over)
router.get('/tenants/:id/export', async (req, res, next) => {
  try {
    const t = await Tenant.findById(req.params.id).lean();
    if (!t) return res.status(404).json({ error: 'Hotel account not found' });
    const docs = await StoreEntry.find({ tenantId: t.tenantId }).lean();
    const entries = {};
    docs.forEach((d) => (entries[d.key] = d.value));
    log('Hotel exported', t);
    res.setHeader('Content-Disposition', `attachment; filename="${t.tenantId}-backup.json"`);
    res.json({ exportedAt: new Date().toISOString(), tenant: t, entries });
  } catch (err) {
    next(err);
  }
});

router.get('/logs', async (req, res, next) => {
  try {
    res.json(await SuperAdminLog.find().sort({ createdAt: -1 }).limit(Number(req.query.limit) || 100).lean());
  } catch (err) {
    next(err);
  }
});

// "Open hotel": a token for that hotel (works even when the hotel is suspended / canceled)
router.post('/impersonate/:id', async (req, res, next) => {
  try {
    const t = await Tenant.findById(req.params.id);
    if (!t) return res.status(404).json({ error: 'Hotel account not found' });
    const admin = (await Account.findOne({ tenantId: t.tenantId, username: 'admin' })) || (await Account.findOne({ tenantId: t.tenantId, role: 'System Admin' })) || (await Account.findOne({ tenantId: t.tenantId }));
    const username = admin?.username || 'admin';
    const token = signImpersonationToken({ tenantId: t.tenantId, accountId: admin?._id, username });
    log('Hotel opened', t);
    res.json({
      token,
      tenantId: t.tenantId,
      hotelName: t.name,
      user: {
        name: admin?.name || 'Hotel Admin', role: 'System Admin', email: admin?.email || t.ownerEmail,
        username, initials: (admin?.name || 'Hotel Admin').slice(0, 2).toUpperCase(), rights: { ...ALL_YES_RIGHTS },
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
