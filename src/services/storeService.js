const StoreEntry = require('../models/StoreEntry');
const { isSyncableKey, USERS_KEY, BOOKINGS_KEY } = require('../config/storeKeys');
const { syncAccountsFromUsersValue } = require('./accountService');
const { syncStructuredModels } = require('./syncStructuredModels');

const MAX_VALUE_BYTES = 14 * 1024 * 1024; // MongoDB documents are limited to 16MB

async function getAll(tenantId) {
  const docs = await StoreEntry.find({ tenantId }).lean();
  const entries = {};
  for (const d of docs) entries[d.key] = { value: d.value, rev: d.rev };

  if (!entries['hotelpms_hotel_info_v3'] && tenantId && tenantId !== 'default') {
    try {
      const Tenant = require('../models/Tenant');
      const tenant = await Tenant.findOne({ tenantId }).lean();
      if (tenant) {
        const defaultInfo = {
          name: tenant.name || 'My Hotel',
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
        const valStr = JSON.stringify(defaultInfo);
        entries['hotelpms_hotel_info_v3'] = { value: valStr, rev: 1 };
        await StoreEntry.create({ tenantId, key: 'hotelpms_hotel_info_v3', value: valStr, rev: 1 }).catch(() => {});
      }
    } catch {
      /* ignore */
    }
  }

  return { entries, empty: docs.length === 0 };
}

async function getManifest(tenantId) {
  const docs = await StoreEntry.find({ tenantId }, 'key rev').lean();
  return docs.map((d) => ({ key: d.key, rev: d.rev }));
}

async function getKeys(tenantId, keys) {
  const wanted = (keys || []).filter(isSyncableKey).slice(0, 300);
  const docs = await StoreEntry.find({ tenantId, key: { $in: wanted } }).lean();
  const entries = {};
  for (const d of docs) entries[d.key] = { value: d.value, rev: d.rev };
  return entries;
}

function parseList(raw) {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
const bookingId = (b) => (b && (b.id || b._id) ? String(b.id || b._id) : null);

// If another PC / the public booking engine added bookings after this client last synced,
// keep them instead of silently overwriting them with the client's older list.
function mergeBookings(existingDoc, clientRaw, baseRev) {
  const server = parseList(existingDoc.value);
  const client = parseList(clientRaw);
  if (!server || !client) return { raw: clientRaw, merged: false };

  const clientIds = new Set(client.map(bookingId).filter(Boolean));
  const idRev = parseIdRev(existingDoc.idRev);
  const keep = server.filter((b) => {
    const id = bookingId(b);
    return id && !clientIds.has(id) && (idRev[id] || 0) > baseRev;
  });
  if (keep.length === 0) return { raw: clientRaw, merged: false };
  return { raw: JSON.stringify([...client, ...keep]), merged: true };
}

function parseIdRev(raw) {
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function trackIdRev(prevDoc, raw, newRev) {
  const list = parseList(raw);
  if (!list) return undefined;
  const idRev = { ...parseIdRev(prevDoc?.idRev) };
  const present = new Set();
  for (const b of list) {
    const id = bookingId(b);
    if (!id) continue;
    present.add(id);
    if (idRev[id] === undefined) idRev[id] = prevDoc ? newRev : 0;
  }
  for (const id of Object.keys(idRev)) if (!present.has(id)) delete idRev[id];
  return JSON.stringify(idRev);
}

async function writeKey(tenantId, key, value) {
  const prev = await StoreEntry.findOne({ tenantId, key }).lean();
  const newRev = (prev?.rev || 0) + 1;
  const set = { value, rev: newRev };
  if (key === BOOKINGS_KEY) set.idRev = trackIdRev(prev, value, newRev);
  const doc = await StoreEntry.findOneAndUpdate({ tenantId, key }, { $set: set }, { upsert: true, new: true }).lean();
  if (key === USERS_KEY) await syncAccountsFromUsersValue(tenantId, value);
  await syncStructuredModels(tenantId, key, value);
  return doc;
}

// changes: [{ key, value (string) | null (delete), baseRev }]
async function applyChanges(tenantId, changes) {
  const results = [];
  for (const ch of changes || []) {
    if (!ch || !isSyncableKey(ch.key)) {
      results.push({ key: ch?.key, skipped: true });
      continue;
    }
    if (ch.value === null || ch.value === undefined) {
      await StoreEntry.deleteOne({ tenantId, key: ch.key });
      results.push({ key: ch.key, deleted: true, rev: 0 });
      continue;
    }
    let value = typeof ch.value === 'string' ? ch.value : JSON.stringify(ch.value);
    if (Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES) {
      results.push({ key: ch.key, error: 'Value too large (max 14MB)' });
      continue;
    }
    let mergedValue;
    if (ch.key === BOOKINGS_KEY) {
      const existing = await StoreEntry.findOne({ tenantId, key: ch.key }).lean();
      if (existing && Number.isFinite(ch.baseRev) && existing.rev > ch.baseRev) {
        const m = mergeBookings(existing, value, ch.baseRev);
        if (m.merged) {
          value = m.raw;
          mergedValue = m.raw;
        }
      }
    }
    const doc = await writeKey(tenantId, ch.key, value);
    results.push({ key: ch.key, rev: doc.rev, ...(mergedValue ? { merged: mergedValue } : {}) });
  }
  return results;
}

async function resetTenant(tenantId) {
  const query = (!tenantId || tenantId === 'all' || tenantId === '*') ? {} : { tenantId };
  await StoreEntry.deleteMany(query);
  
  const Room = require('../models/Room');
  const RoomType = require('../models/RoomType');
  const Booking = require('../models/Booking');
  const Guest = require('../models/Guest');
  const Property = require('../models/Property');
  const AuditLog = require('../models/AuditLog');
  const RatePlan = require('../models/RatePlan');
  const Addon = require('../models/Addon');
  const TaxRule = require('../models/TaxRule');
  const CorporateAccount = require('../models/CorporateAccount');
  const Deposit = require('../models/Deposit');
  const Folio = require('../models/Folio');
  const NightAudit = require('../models/NightAudit');
  const Payment = require('../models/Payment');

  await Promise.all([
    Room.deleteMany(query),
    RoomType.deleteMany(query),
    Booking.deleteMany(query),
    Guest.deleteMany(query),
    Property.deleteMany(query),
    AuditLog.deleteMany(query),
    RatePlan.deleteMany(query),
    Addon.deleteMany(query),
    TaxRule.deleteMany(query),
    CorporateAccount.deleteMany(query),
    Deposit.deleteMany(query),
    Folio.deleteMany(query),
    NightAudit.deleteMany(query),
    Payment.deleteMany(query),
  ]);
}

module.exports = { getAll, getManifest, getKeys, applyChanges, writeKey, resetTenant };
