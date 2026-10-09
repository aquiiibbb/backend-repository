const express = require('express');
const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const StoreEntry = require('../models/StoreEntry');
const SuperAdminLog = require('../models/SuperAdminLog');
const store = require('../services/storeService');
const { isSyncableKey } = require('../config/storeKeys');

// Super admin "data explorer": read every hotel's data like MongoDB Compass does (filtered by hotel),
// and read / edit / delete the hotel's saved data (the real source of truth) key by key.
// Mounted under /api/superadmin/data (super admin login required - see superAdminRoutes.js).
const router = express.Router();

const tryModel = (name) => {
  try {
    return require(`../models/${name}`);
  } catch {
    return null;
  }
};

const COLLS = {
  properties: { model: 'Property', label: 'Properties (hotel info)', search: ['propertyName', 'email', 'contactName', 'propertyWebsite'], sort: { createdAt: 1 } },
  roomtypes: { model: 'RoomType', label: 'Room types', search: ['name', 'roomType', 'roomIds', 'typeId'], sort: { createdAt: 1 } },
  rooms: { model: 'Room', label: 'Rooms', search: ['roomNumber', 'roomType', 'foStatus', 'housekeepingStatus'], sort: { roomNumber: 1 } },
  bookings: { model: 'Booking', label: 'Bookings', search: ['id', 'guestName', 'roomNumber', 'guestEmail', 'guestPhone', 'status', 'resCode'], sort: { createdAt: -1 } },
  guests: { model: 'Guest', label: 'Guests', search: ['guestId', 'name', 'guestName', 'email', 'phone'], sort: { createdAt: -1 } },
  rateplans: { model: 'RatePlan', label: 'Rate plans', search: ['planId', 'name'], sort: { createdAt: 1 } },
  addons: { model: 'Addon', label: 'Add-ons', search: ['addonId', 'name'], sort: { createdAt: 1 } },
  taxrules: { model: 'TaxRule', label: 'Tax rules', search: ['taxId', 'name'], sort: { createdAt: 1 } },
  auditlogs: { model: 'AuditLog', label: 'Audit logs', search: ['logId', 'action', 'details', 'user'], sort: { createdAt: -1 } },
  folios: { model: 'Folio', label: 'Folios', search: ['folioId', 'bookingId', 'guestName'], sort: { createdAt: -1 } },
  payments: { model: 'Payment', label: 'Payments', search: ['id', 'bookingId', 'method'], sort: { createdAt: -1 } },
  deposits: { model: 'Deposit', label: 'Deposits', search: ['id', 'bookingId'], sort: { createdAt: -1 } },
  nightaudits: { model: 'NightAudit', label: 'Night audits', search: ['auditId'], sort: { createdAt: -1 } },
  corporateaccounts: { model: 'CorporateAccount', label: 'Corporate accounts', search: ['name', 'companyName'], sort: { createdAt: -1 } },
  accounts: { model: 'Account', label: 'Staff logins', search: ['username', 'email', 'name', 'role'], sort: { createdAt: 1 }, hide: ['passwordHash'] },
};

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const coll = (name) => {
  const c = COLLS[name];
  const M = c && tryModel(c.model);
  return M ? { ...c, name, M } : null;
};
const tenantFilter = (tenantId) => (tenantId ? { tenantId: String(tenantId) } : {});

// Short, table-friendly version of one value (images / long text / nested objects are summarised)
function short(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') {
    if (v.startsWith('data:')) return `[file ${Math.round(v.length / 1024)} KB]`;
    return v.length > 140 ? `${v.slice(0, 140)}…` : v;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) return `[${v.length} items]`;
  if (v && v._bsontype === 'ObjectId') return String(v);
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    const s = JSON.stringify(v);
    return s.length <= 60 ? s : `{${keys.length} fields}`;
  }
  return String(v);
}

function previewDoc(doc, hide = []) {
  const out = { _id: String(doc._id) };
  for (const [k, v] of Object.entries(doc)) {
    if (k === '_id' || k === '__v' || hide.includes(k)) continue;
    out[k] = short(v);
  }
  return out;
}

const PREFERRED = ['tenantId', 'id', 'roomNumber', 'name', 'propertyName', 'guestName', 'username', 'email', 'roomType', 'status', 'checkInDate', 'checkOutDate', 'totalAmount', 'action', 'details', 'createdAt'];
function pickColumns(rows) {
  const freq = new Map();
  rows.forEach((r) => Object.keys(r).forEach((k) => k !== '_id' && freq.set(k, (freq.get(k) || 0) + 1)));
  const keys = [...freq.keys()];
  keys.sort((a, b) => {
    const pa = PREFERRED.indexOf(a);
    const pb = PREFERRED.indexOf(b);
    if (pa !== -1 || pb !== -1) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
    return freq.get(b) - freq.get(a);
  });
  return keys.slice(0, 14);
}

// Sidebar: every collection with its document count (for one hotel, or all hotels)
router.get('/collections', async (req, res, next) => {
  try {
    const filter = tenantFilter(req.query.tenantId);
    const out = [];
    await Promise.all(
      Object.keys(COLLS).map(async (name) => {
        const c = coll(name);
        if (!c) return;
        out.push({ name, label: c.label, count: await c.M.collection.countDocuments(filter) });
      })
    );
    const order = Object.keys(COLLS);
    out.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.get('/collections/:coll', async (req, res, next) => {
  try {
    const c = coll(req.params.coll);
    if (!c) return res.status(404).json({ error: 'Unknown collection' });
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 200);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const filter = tenantFilter(req.query.tenantId);
    const q = String(req.query.q || '').trim();
    if (q) filter.$or = c.search.map((f) => ({ [f]: { $regex: escapeRe(q), $options: 'i' } }));

    const [total, docs] = await Promise.all([
      c.M.collection.countDocuments(filter),
      c.M.collection.find(filter).sort(c.sort || { _id: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
    ]);
    const rows = docs.map((d) => previewDoc(d, c.hide));
    res.json({ collection: c.name, label: c.label, total, page, limit, pages: Math.max(Math.ceil(total / limit), 1), columns: pickColumns(rows), rows });
  } catch (err) {
    next(err);
  }
});

router.get('/collections/:coll/:id', async (req, res, next) => {
  try {
    const c = coll(req.params.coll);
    if (!c) return res.status(404).json({ error: 'Unknown collection' });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Bad id' });
    const doc = await c.M.collection.findOne({ _id: new mongoose.Types.ObjectId(req.params.id) });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    (c.hide || []).forEach((k) => delete doc[k]);
    res.json(doc);
  } catch (err) {
    next(err);
  }
});

// ---------- the hotel's saved data (source of truth), key by key ----------
const getTenant = async (tid) => Tenant.findOne({ tenantId: String(tid) }).lean();

router.get('/store/:tid', async (req, res, next) => {
  try {
    if (!(await getTenant(req.params.tid))) return res.status(404).json({ error: 'Hotel not found' });
    const docs = await StoreEntry.find({ tenantId: req.params.tid }).sort({ key: 1 }).lean();
    res.json(
      docs.map((d) => {
        const value = d.value || '';
        let type = 'text';
        let count = null;
        try {
          const p = JSON.parse(value);
          if (Array.isArray(p)) { type = 'list'; count = p.length; }
          else if (p && typeof p === 'object') { type = 'object'; count = Object.keys(p).length; }
        } catch { /* plain text */ }
        return { key: d.key, type, count, rev: d.rev, bytes: Buffer.byteLength(value, 'utf8'), updatedAt: d.updatedAt };
      })
    );
  } catch (err) {
    next(err);
  }
});

router.get('/store/:tid/:key', async (req, res, next) => {
  try {
    const d = await StoreEntry.findOne({ tenantId: req.params.tid, key: req.params.key }).lean();
    if (!d) return res.status(404).json({ error: 'Nothing saved under this key' });
    res.json({ key: d.key, value: d.value, rev: d.rev, updatedAt: d.updatedAt });
  } catch (err) {
    next(err);
  }
});

const logAction = (action, t, detail) => SuperAdminLog.create({ action, tenantId: t.tenantId, hotelName: t.name, detail }).catch(() => {});

router.put('/store/:tid/:key', async (req, res, next) => {
  try {
    const t = await getTenant(req.params.tid);
    if (!t) return res.status(404).json({ error: 'Hotel not found' });
    const key = req.params.key;
    if (!isSyncableKey(key)) return res.status(400).json({ error: 'This key cannot be edited' });
    const value = typeof req.body?.value === 'string' ? req.body.value : JSON.stringify(req.body?.value);
    if (value === undefined) return res.status(400).json({ error: 'value is required' });
    if (Buffer.byteLength(value, 'utf8') > 14 * 1024 * 1024) return res.status(400).json({ error: 'Value too large (max 14MB)' });

    // keep JSON data valid JSON
    const prev = await StoreEntry.findOne({ tenantId: t.tenantId, key }).lean();
    let prevWasJson = false;
    try { JSON.parse(prev?.value); prevWasJson = !!prev; } catch { /* not json */ }
    if (prevWasJson || req.body?.json) {
      try { JSON.parse(value); } catch { return res.status(400).json({ error: 'This is not valid JSON. Nothing was saved.' }); }
    }
    const doc = await store.writeKey(t.tenantId, key, value);
    logAction('Data edited', t, `${key} (${Buffer.byteLength(value, 'utf8')} bytes)`);
    res.json({ key, rev: doc.rev });
  } catch (err) {
    next(err);
  }
});

router.delete('/store/:tid/:key', async (req, res, next) => {
  try {
    const t = await getTenant(req.params.tid);
    if (!t) return res.status(404).json({ error: 'Hotel not found' });
    const key = req.params.key;
    if (!isSyncableKey(key)) return res.status(400).json({ error: 'This key cannot be deleted' });
    // A list (bookings, rooms ...) is emptied through the normal save path so the readable collections are emptied too;
    // anything else is removed.
    const prev = await StoreEntry.findOne({ tenantId: t.tenantId, key }).lean();
    let isList = false;
    try { isList = Array.isArray(JSON.parse(prev?.value)); } catch { /* not json */ }
    if (isList) await store.writeKey(t.tenantId, key, '[]');
    else await StoreEntry.deleteOne({ tenantId: t.tenantId, key });
    logAction('Data deleted', t, key);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
