const crypto = require('crypto');
const Room = require('../models/Room');
const RoomType = require('../models/RoomType');
const Booking = require('../models/Booking');
const Guest = require('../models/Guest');
const Property = require('../models/Property');
const RatePlan = require('../models/RatePlan');
const Addon = require('../models/Addon');
const TaxRule = require('../models/TaxRule');
const AuditLog = require('../models/AuditLog');
const CorporateAccount = require('../models/CorporateAccount');
const Deposit = require('../models/Deposit');
const Folio = require('../models/Folio');
const NightAudit = require('../models/NightAudit');
const Payment = require('../models/Payment');
const MiscTransaction = require('../models/MiscTransaction');

/*
 * The StoreEntry collection keeps the exact frontend data. These structured collections are a
 * readable mirror of it. Rules of the mirror:
 *   1. EVERY field the frontend sent is stored (signature, ID scan images, payments, extras ...).
 *   2. Nothing is invented: a value that the input does not have is simply not written
 *      (no fake rate 150, no room "101", no "Miami" ...).
 *   3. Legacy/canonical fields that the older REST controllers read (roomNumber, checkInDate,
 *      guestName, status ...) are filled only from the real input values.
 */

const RESERVED = new Set(['_id', '__v', 'createdAt', 'updatedAt']);
const MONGO_OPTS = { upsert: true, new: true, setDefaultsOnInsert: false };

function safeParse(val) {
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

// ---------- small helpers ----------
const isEmpty = (v) => v === undefined || v === null || v === '';
function pick(obj, ...keys) {
  for (const k of keys) if (!isEmpty(obj?.[k])) return obj[k];
  return undefined;
}
function str(v) {
  if (isEmpty(v)) return undefined;
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}
function num(v) {
  if (isEmpty(v) || typeof v === 'boolean') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function bool(v) {
  return typeof v === 'boolean' ? v : undefined;
}
const date10 = (v) => (isEmpty(v) ? undefined : String(v).substring(0, 10));

// MongoDB field names cannot start with "$" or contain "." - fix only those (rare) keys.
function sanitizeKey(k) {
  return String(k).replace(/\./g, '_').replace(/^\$/, '_');
}
function sanitizeValue(v) {
  if (Array.isArray(v)) return v.map(sanitizeValue);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const o = {};
    for (const [k, val] of Object.entries(v)) if (val !== undefined) o[sanitizeKey(k)] = sanitizeValue(val);
    return o;
  }
  return v;
}

// Does the raw value fit the type the model declares for that field? (avoids Mongoose cast errors)
function fit(schemaPath, v) {
  switch (schemaPath.instance) {
    case 'String':
      return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? { ok: true, value: String(v) } : { ok: false };
    case 'Number': {
      const n = num(v);
      return n !== undefined ? { ok: true, value: n } : { ok: false };
    }
    case 'Boolean':
      return typeof v === 'boolean' ? { ok: true, value: v } : { ok: false };
    case 'Array':
      return Array.isArray(v) ? { ok: true, value: v } : { ok: false };
    default:
      return { ok: true, value: v };
  }
}

/**
 * Builds the $set object: all raw fields (as sent) + canonical fields (computed from real values only).
 * A raw field whose type clashes with the model's declared type is not lost - it is kept as `input_<name>`.
 */
function buildSet(Model, raw, canonical = {}) {
  const set = {};
  for (const [k0, v0] of Object.entries(raw || {})) {
    if (v0 === undefined || v0 === '' || v0 === null) continue;
    if (RESERVED.has(k0)) {
      continue;
    }
    const k = sanitizeKey(k0);
    const v = sanitizeValue(v0);
    const pathType = Model.schema.pathType(k);
    if (pathType === 'nested') {
      set[`input_${k}`] = v;
      continue;
    }
    const sp = Model.schema.path(k);
    if (!sp) {
      set[k] = v;
      continue;
    }
    const f = fit(sp, v);
    if (f.ok) set[k] = f.value;
    else set[`input_${k}`] = v;
  }
  for (const [k, v] of Object.entries(canonical)) if (v !== undefined && v !== '' && v !== null) set[k] = v;
  return set;
}

// ---------- status mappers (older REST controllers filter on these exact values) ----------
function mapHousekeeping(s) {
  if (isEmpty(s)) return undefined;
  const l = String(s).toLowerCase();
  if (l.includes('clean')) return 'Clean';
  if (l.includes('dirty')) return 'Dirty';
  if (l.includes('inspect')) return 'Inspected';
  if (l.includes('maintenance')) return 'Maintenance';
  if (l.includes('out')) return 'Out of Service';
  return undefined;
}

function mapFoStatus(s) {
  if (isEmpty(s)) return undefined;
  const l = String(s).toLowerCase();
  if (l.includes('occup')) return 'Occupied';
  if (l.includes('reserv')) return 'Reserved';
  if (l.includes('vacant') || l.includes('avail')) return 'Vacant';
  return undefined;
}

function mapBookingStatus(s) {
  if (isEmpty(s)) return undefined;
  const l = String(s).toLowerCase();
  if (l.includes('check') && l.includes('in')) return 'Checked In';
  if (l.includes('check') && l.includes('out')) return 'Checked Out';
  if (l.includes('cancel')) return 'Cancelled';
  if (l.includes('no') && l.includes('show')) return 'No Show';
  return 'Confirmed';
}

// Guest profile fields that are copied from a booking onto the Guest document (only when filled)
const GUEST_EXTRA_FIELDS = [
  'dob', 'dateOfBirth', 'gender', 'city', 'state', 'zip', 'companyName', 'gstNumber',
  'digitalSignature', 'signature', 'signatureOnFile',
  'guestPhoto', 'photoUrl', 'capturedPhoto', 'facePhoto', 'photo', 'fullScanPhoto',
  'scannedIdUrl', 'idFront', 'idBack', 'idDocumentUrl', 'capturedImages',
];


// ---------- clean-mirror helpers ----------
// copy of `raw` without the listed keys and without empty-string values
function cleanRaw(raw, dropKeys = []) {
  const o = {};
  for (const [k, v] of Object.entries(raw || {})) {
    if (dropKeys.includes(k)) continue;
    if (v === undefined || v === '' || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'number' && v === 0 && BOOKING_FILLER_UNSET.includes(k)) continue;
    if (typeof v === 'boolean' && v === false && BOOKING_FILLER_UNSET.includes(k)) continue;
    o[k] = v;
  }
  return o;
}
// number only when it is really filled (> 0); the frontend sends 0 for fields it has no input for
const posNum = (v) => {
  const n = num(v);
  return n !== undefined && n > 0 ? n : undefined;
};
// keys that must be removed from the stored document (old duplicates / stale values)
function buildUnset(keys, set) {
  const u = {};
  for (const k of keys) if (!(k in set)) u[k] = '';
  return u;
}
function update(set, unset) {
  const op = { $set: set };
  if (unset && Object.keys(unset).length) op.$unset = unset;
  return op;
}

// Room type: only these keys are the real inputs of the "Room Type" form. Everything else the
// frontend adds (aliases such as price/baseRate/extraPersonRate, 0-valued price fields, empty image ...) is skipped.
const ROOMTYPE_ALIAS_KEYS = [
  'id', 'roomType', 'maxInfant', 'roomMaxOccupancy', 'totalOccupancy', 'occupancy', 'price', 'baseRate',
  'defaultRate', 'extraPersonRate', 'extraAdultRate', 'extraChildRate', 'image', 'virtual', 'isStaffRoom',
  'chargeRules', 'basePrice', 'extraAdultPrice', 'extraChildPrice', 'extraInfantPrice', 'maxOccupancy',
  'maxInfants', 'isVirtual', 'name', 'roomIds',
];
const ROOMTYPE_UNSET_CANDIDATES = [
  'id', 'totalOccupancy', 'occupancy', 'price', 'baseRate',
  'extraPersonRate', 'extraAdultRate', 'extraChildRate', 'image', 'isStaffRoom', 'chargeRules',
  'input_createdAt', 'input_updatedAt',
];

// Property: raw frontend keys that are already stored (once) in their canonical / nested place.
const PROPERTY_RAW_HANDLED = [
  'name', 'website', 'taxId', 'totalRooms', 'currency', 'currencyCode', 'phone', 'country', 'state', 'city',
  'address', 'zipcode', 'zipCode', 'latitude', 'longitude', 'logo', 'logoUrl', 'isLogoRemoved',
  'scheduledAuditTime', 'scheduledTime', 'automatedAuditPopupPrompt', 'contactName', 'email', 'rating',
];
const PROPERTY_UNSET_CANDIDATES = [
  'name', 'website', 'taxId', 'totalRooms', 'logo', 'country', 'state', 'city', 'address', 'zipcode', 'zipCode',
  'latitude', 'longitude', 'isLogoRemoved', 'scheduledAuditTime', 'scheduledTime', 'automatedAuditPopupPrompt',
  'input_currency', 'input_phone', 'input_location', 'input_nightAudit', 'input_createdAt', 'input_updatedAt',
  'logoUrl', 'propertyWebsite', 'taxIdentificationNumber', 'totalRoomCount', 'contactName', 'email', 'rating',
  'currency.code', 'currency.symbol', 'currency.name', 'phone.countryCode', 'phone.dialCode', 'phone.number',
  'location.country', 'location.state', 'location.city', 'location.address', 'location.zipCode',
  'location.latitude', 'location.longitude', 'nightAudit.scheduledTime', 'nightAudit.automatedAuditPopupPrompt',
];

const BOOKING_ALIAS_KEYS = [
  'guest', 'email', 'phone', 'city', 'state', 'country', 'zip',
  'room', 'roomNo', 'number', 'type', 'category',
  'checkIn', 'checkOut', 'rate', 'price', 'total', 'source',
  'dob', 'signature', 'photoUrl', 'capturedPhoto', 'facePhoto', 'photo',
  'statusInput', 'input_createdAt', 'input_updatedAt',
  'idFront', 'idBack', 'idDocumentUrl', 'scannedIdUrl', 'cardCvv', 'cardExpiry', 'cardNumber',
  'companyName', 'couponCode', 'discountValue', 'otaId', 'pin', 'remark', 'taxExemptReason'
];
const BOOKING_FILLER_UNSET = [
  'advanceAmount', 'advancePaymentDate', 'depositAmount', 'depositBalance', 'depositMethod', 'depositMode',
  'discountAmount', 'discountPercent', 'discountValue', 'extraCharges', 'grossRatePerNight',
  'hasAdditionalGuests', 'hasDeposit', 'idScanned', 'isComplimentary', 'isEnquiry', 'isTaxExempt',
  'taxExempt', 'securityDepositCollected', 'signatureOnFile', 'segment', 'subSegment', 'cardName'
];
const BOOKING_UNSET_CANDIDATES = [
  ...BOOKING_ALIAS_KEYS,
  ...BOOKING_FILLER_UNSET,
  'guestPhoto'
];

async function syncStructuredModels(tenantId, key, value) {
  if (!key || !value) return;

  try {
    // 1. ROOM TYPES
    if (key === 'hotelpms_room_types_v3' || key === 'hotelpms_room_types' || key === 'hotelpms_room_types_v1') {
      const types = safeParse(value);
      if (Array.isArray(types)) {
        if (types.length === 0) {
          await RoomType.deleteMany({ tenantId });
        } else {
          for (const t of types) {
            if (!t || (!t.id && !t.typeId && !t.name && !t.roomType)) continue;
            const typeId = String(t.id || t.typeId || t.name || t.roomType).trim();
            const name = String(t.name || t.roomType || typeId).trim();
            const defaultAdults = num(pick(t, 'defaultAdults', 'defaultAdult'));
            const maxAdults = num(pick(t, 'maxAdults', 'maxAdult'));
            const maxChildren = num(pick(t, 'maxChildren', 'maxChild'));
            const minChildAge = num(pick(t, 'minChildAge', 'childMinAge', 'childrenMinAge'));
            const maxChildAge = num(pick(t, 'maxChildAge', 'childMaxAge', 'childrenMaxAge'));
            const maxInfants = num(pick(t, 'maxInfants', 'maxInfant'));
            const minInfantAge = num(pick(t, 'minInfantAge', 'infantMinAge'));
            const maxInfantAge = num(pick(t, 'maxInfantAge', 'infantMaxAge'));
            const maxOccupancy = num(pick(t, 'maxOccupancy', 'totalOccupancy', 'occupancy', 'roomMaxOccupancy'));
            const virtual = bool(t.isVirtual !== undefined ? t.isVirtual : t.virtual);
            const roomIds = Array.isArray(t.roomIds) ? t.roomIds.join(',') : str(t.roomIds);
            const photo = str(pick(t, 'photo', 'image'));

            const set = buildSet(RoomType, cleanRaw(t, ROOMTYPE_ALIAS_KEYS), {
              typeId,
              name,
              roomType: name,
              roomIds,
              defaultAdults,
              maxAdults,
              maxChildren,
              minChildAge,
              maxChildAge,
              maxInfant: maxInfants,
              maxInfants,
              minInfantAge,
              maxInfantAge,
              maxOccupancy,
              roomMaxOccupancy: maxOccupancy,
              isVirtual: virtual,
              virtual,
              // price fields are written only when they really have a value (not the frontend's 0 filler)
              basePrice: posNum(pick(t, 'basePrice', 'price', 'defaultRate', 'baseRate')),
              extraAdultPrice: posNum(pick(t, 'extraAdultPrice', 'extraAdultRate', 'extraPersonRate')),
              extraChildPrice: posNum(pick(t, 'extraChildPrice', 'extraChildRate')),
              extraInfantPrice: posNum(t.extraInfantPrice),
              photo,
            });
            await RoomType.findOneAndUpdate(
              { tenantId, $or: [{ typeId }, { name }, { roomType: name }] },
              update(set, buildUnset(ROOMTYPE_UNSET_CANDIDATES, set)),
              MONGO_OPTS
            );
          }
        }
      }
    }

    // 2. ROOMS
    if (key === 'hotelpms_room_numbers_v3' || key === 'hotelpms_room_numbers' || key === 'hotelpms_rooms_list_v1') {
      const rooms = safeParse(value);
      if (Array.isArray(rooms)) {
        if (rooms.length === 0) {
          await Room.deleteMany({ tenantId });
        } else {
          for (const r of rooms) {
            if (!r || (!r.no && !r.roomNumber && !r.number && !r.id)) continue;
            const roomNumber = String(r.no || r.roomNumber || r.number || r.id).trim();
            const roomType = str(pick(r, 'type', 'roomType'));
            const rate = num(pick(r, 'rate', 'ratePerNight', 'price'));
            const hk = pick(r, 'housekeeping');
            const set = {
              roomNumber,
              roomType,
              floor: num(r.floor) || 1,
              ratePerNight: num(pick(r, 'ratePerNight', 'rate', 'price')) || 0,
              housekeepingStatus: mapHousekeeping(hk) || 'Clean',
              foStatus: mapFoStatus(r.status) || 'Vacant',
              isClean: hk !== undefined ? String(hk).toLowerCase() === 'clean' : true,
              petFriendly: bool(r.petFriendly),
              nonSmoking: bool(r.nonSmoking),
              isBlocked: bool(r.isBlocked),
              blockReason: str(r.blockReason) || '',
            };
            await Room.findOneAndUpdate(
              { tenantId, roomNumber },
              {
                $set: set,
                $unset: { no: '', id: '', type: '', status: '', housekeeping: '', price: '', rate: '', number: '' }
              },
              MONGO_OPTS
            );
          }
        }
      }
    }

    // 3. BOOKINGS & GUESTS
    if (key === 'hotelpms_bookings_v1') {
      const rawBookings = safeParse(value);
      if (Array.isArray(rawBookings)) {
        if (rawBookings.length === 0) {
          await Booking.deleteMany({ tenantId });
          await Guest.deleteMany({ tenantId });
        } else {
          const bMap = new Map();
          for (const b of rawBookings) {
            if (!b) continue;
            const bId = String(b.id || b._id || '').trim();
            const rNo = String(pick(b, 'roomNumber', 'room', 'roomNo', 'number') || '').trim();
            const cIn = String(date10(pick(b, 'checkInDate', 'checkIn')) || '').trim();
            const cOut = String(date10(pick(b, 'checkOutDate', 'checkOut')) || '').trim();
            const gName = String(pick(b, 'guestName', 'guest') || '').trim().toLowerCase();
            const compositeKey = bId || (rNo && cIn ? `${rNo}_${cIn}_${cOut}_${gName}` : null);
            if (!compositeKey) continue;
            if (!bMap.has(compositeKey)) {
              bMap.set(compositeKey, b);
            } else {
              const existing = bMap.get(compositeKey);
              const isExistingReal = existing._id || (existing.id && !existing.id.startsWith('bk_'));
              const isNewReal = b._id || (b.id && !b.id.startsWith('bk_'));
              if (isNewReal && !isExistingReal) {
                bMap.set(compositeKey, b);
              }
            }
          }
          const bookings = Array.from(bMap.values());
          const presentBookingIds = [];
          for (const b of bookings) {
            if (!b || isEmpty(b.id ?? b._id)) continue;
            const id = String(b.id ?? b._id);
            presentBookingIds.push(id);
            const guestName = str(pick(b, 'guestName', 'guest'));
            const guestEmail = str(pick(b, 'guestEmail', 'email'));
            const guestPhone = str(pick(b, 'guestPhone', 'phone'));
            const guestCity = str(pick(b, 'guestCity', 'city'));
            const guestState = str(pick(b, 'guestState', 'state'));
            const guestCountry = str(pick(b, 'guestCountry', 'country', 'nationality')) || 'India';
            const roomNumber = str(pick(b, 'roomNumber', 'room', 'roomNo', 'number'));
            const roomType = str(pick(b, 'roomType', 'type', 'category'));
            const checkInDate = date10(pick(b, 'checkInDate', 'checkIn'));
            const checkOutDate = date10(pick(b, 'checkOutDate', 'checkOut'));
            const ratePerNight = num(pick(b, 'ratePerNight', 'rate', 'price'));
            const totalAmount = num(pick(b, 'totalAmount', 'total'));
            const bookingSource = str(pick(b, 'bookingSource', 'source'));

            const firstCapUrl = Array.isArray(b.capturedImages) && b.capturedImages[0]?.url ? str(b.capturedImages[0].url) : undefined;
            const photoVal = str(pick(b, 'guestPhoto', 'photoUrl', 'capturedPhoto')) || firstCapUrl;

            const canonical = {
              id,
              resCode: str(pick(b, 'resCode', 'reservationCode')),
              guestName,
              guestEmail,
              guestPhone,
              guestCity,
              guestState,
              guestCountry,
              guestZip: str(pick(b, 'guestZip', 'zip')),
              dateOfBirth: str(pick(b, 'dateOfBirth', 'dob')),
              digitalSignature: str(pick(b, 'digitalSignature', 'signature')),
              guestPhoto: photoVal,
              nationality: guestCountry,
              roomNumber,
              roomType,
              checkInDate,
              checkOutDate,
              ratePerNight,
              totalAmount,
              bookingSource,
              notes: str(pick(b, 'notes', 'specialRequests')),
              status: mapBookingStatus(b.status),
            };

            const cleanObj = cleanRaw(b, BOOKING_ALIAS_KEYS);
            const set = buildSet(Booking, cleanObj, canonical);

            await Booking.findOneAndUpdate(
              { tenantId, id },
              update(set, buildUnset(BOOKING_UNSET_CANDIDATES, set)),
              MONGO_OPTS
            );

            // Guest profile mirror (same guestId scheme as before so no duplicates appear)
            if (guestName) {
              const guestId = `gst_${guestName.toLowerCase().replace(/\s+/g, '_')}`;
              const extra = {};
              for (const f of GUEST_EXTRA_FIELDS) if (!isEmpty(b[f]) && !(Array.isArray(b[f]) && b[f].length === 0)) extra[f] = b[f];
              const scannedDocs = (Array.isArray(b.scannedImages) ? b.scannedImages : [])
                .filter((x) => x && x.url)
                .map((x) => ({
                  id: str(x.id),
                  title: str(x.title),
                  type: str(x.idType),
                  number: str(x.idNumber),
                  country: str(x.issueCountry || x.country),
                  url: x.url,
                  date: str(x.uploadedAt || x.scannedAt),
                }));
              const guestSet = buildSet(Guest, extra, {
                guestId,
                guestName,
                email: guestEmail,
                phone: guestPhone,
                address: str(b.address),
                country: guestCountry,
                idType: str(b.idType),
                idNumber: str(b.idNumber),
                scannedDocs: scannedDocs.length ? scannedDocs : undefined,
              });
              await Guest.findOneAndUpdate({ tenantId, guestId }, { $set: guestSet }, MONGO_OPTS);
            }
          }
          if (presentBookingIds.length > 0) {
            await Booking.deleteMany({ tenantId, id: { $nin: presentBookingIds } });
          }
        }
      }
    }

    // 4. PROPERTY / HOTEL INFO
    if (key === 'hotelpms_hotel_info_v3' || key === 'hotelpms_hotel_info') {
      const info = safeParse(value);
      if (info && typeof info === 'object' && !Array.isArray(info)) {
        let tenantName = '';
        try {
          const Tenant = require('../models/Tenant');
          const tDoc = await Tenant.findOne({ tenantId }).lean();
          if (tDoc && tDoc.name) tenantName = tDoc.name;
        } catch {}

        const existingProp = await Property.findOne({ tenantId }).lean();

        const ph = info.phone;
        const phoneObj = ph && typeof ph === 'object' ? ph : null;
        const cur = info.currency;
        const curObj = cur && typeof cur === 'object' ? cur : null;
        const curLabel = typeof cur === 'string' && cur ? cur : undefined;
        const curSymbol = curObj ? str(curObj.symbol) : curLabel ? (curLabel.match(/\(([^)]+)\)\s*$/) || [])[1] : undefined;

        const country = str(info.country) || existingProp?.location?.country || 'United States';
        const logo = !info.isLogoRemoved ? (str(pick(info, 'logoUrl', 'logo')) || existingProp?.logoUrl || '') : '';

        const propName = str(pick(info, 'name', 'propertyName')) || existingProp?.propertyName || tenantName || 'My Hotel';
        const propWebsite = info.website !== undefined ? String(info.website || '').trim() : (info.propertyWebsite !== undefined ? String(info.propertyWebsite || '').trim() : (existingProp?.propertyWebsite || ''));
        const taxId = info.taxId !== undefined ? String(info.taxId || '').trim() : (info.taxIdentificationNumber !== undefined ? String(info.taxIdentificationNumber || '').trim() : (existingProp?.taxIdentificationNumber || ''));
        const totalRooms = num(pick(info, 'totalRooms', 'totalRoomCount')) ?? existingProp?.totalRoomCount ?? 50;
        const contact = info.contactName !== undefined ? String(info.contactName || '').trim() : (existingProp?.contactName || '');
        const emailVal = info.email !== undefined ? String(info.email || '').trim().toLowerCase() : (existingProp?.email || '');
        const ratingVal = num(info.rating) ?? existingProp?.rating ?? 5;

        const propertySet = {
          tenantId,
          propertyName: propName,
          propertyWebsite: propWebsite,
          taxIdentificationNumber: taxId,
          totalRoomCount: totalRooms,
          contactName: contact,
          email: emailVal,
          rating: ratingVal,
          logoUrl: logo,
          currency: {
            code: curObj ? str(curObj.code) || 'USD' : (str(info.currencyCode) || existingProp?.currency?.code || 'USD'),
            symbol: curSymbol || existingProp?.currency?.symbol || '$',
            name: curLabel || (curObj ? str(curObj.name) : undefined) || existingProp?.currency?.name || 'US Dollar ($)'
          },
          phone: {
            countryCode: phoneObj ? str(phoneObj.countryCode) || 'US' : (existingProp?.phone?.countryCode || 'US'),
            dialCode: phoneObj ? str(phoneObj.dialCode) || '+1' : (existingProp?.phone?.dialCode || '+1'),
            number: phoneObj ? str(phoneObj.number) || '' : (str(ph) || existingProp?.phone?.number || '')
          },
          location: {
            country: country,
            state: info.state !== undefined ? String(info.state || '').trim() : (existingProp?.location?.state || ''),
            city: info.city !== undefined ? String(info.city || '').trim() : (existingProp?.location?.city || ''),
            address: info.address !== undefined ? String(info.address || '').trim() : (existingProp?.location?.address || ''),
            zipCode: pick(info, 'zipcode', 'zipCode') !== undefined ? String(pick(info, 'zipcode', 'zipCode') || '').trim() : (existingProp?.location?.zipCode || ''),
            latitude: num(info.latitude) ?? existingProp?.location?.latitude,
            longitude: num(info.longitude) ?? existingProp?.location?.longitude
          },
          nightAudit: {
            scheduledTime: str(pick(info, 'scheduledAuditTime', 'scheduledTime')) || existingProp?.nightAudit?.scheduledTime || '02:00',
            automatedAuditPopupPrompt: bool(info.automatedAuditPopupPrompt) ?? existingProp?.nightAudit?.automatedAuditPopupPrompt ?? true
          }
        };

        await Property.findOneAndUpdate(
          { tenantId },
          { $set: propertySet },
          MONGO_OPTS
        );
      }
    }

    // 5. RATE PLANS
    if (key === 'hotelpms_rate_plans_v3' || key === 'hotelpms_rate_plans') {
      const plans = safeParse(value);
      if (Array.isArray(plans)) {
        if (plans.length === 0) {
          await RatePlan.deleteMany({ tenantId });
        } else {
          const presentPlanIds = [];
          for (const p of plans) {
            if (!p || (!p.id && !p.planId && !p.name)) continue;
            const planId = String(p.id || p.planId || p.name).trim();
            presentPlanIds.push(planId);
            const rate = num(pick(p, 'ratePerNight', 'adjustment', 'price', 'rate'));
            const nights = num(pick(p, 'nights', 'durationNights'));
            const set = {
              planId,
              name: String(p.name || planId).trim(),
              code: str(p.code) || '',
              description: str(p.description) || '',
              roomType: str(p.roomType) || 'All',
              ratePerNight: rate || 0,
              nights: nights !== undefined ? Math.max(1, nights) : 1,
              status: str(p.status) || 'Active',
              isActive: bool(p.active !== undefined ? p.active : (p.status ? String(p.status).toLowerCase() === 'active' : true)),
            };
            await RatePlan.findOneAndUpdate(
              { tenantId, planId },
              {
                $set: set,
                $unset: { id: '', price: '', durationNights: '', adjustment: '' }
              },
              MONGO_OPTS
            );
          }
          if (presentPlanIds.length > 0) {
            await RatePlan.deleteMany({ tenantId, planId: { $nin: presentPlanIds } });
          }
        }
      }
    }

    // 6. ADDONS
    if (key === 'hotelpms_addons_v3' || key === 'hotelpms_addons') {
      const addons = safeParse(value);
      if (Array.isArray(addons)) {
        if (addons.length === 0) {
          await Addon.deleteMany({ tenantId });
        } else {
          const presentAddonIds = [];
          for (const a of addons) {
            if (!a || (!a.id && !a.addonId && !a.name)) continue;
            const addonId = String(a.id || a.addonId || a.name).trim();
            presentAddonIds.push(addonId);
            const set = buildSet(Addon, a, {
              addonId,
              name: String(a.name || addonId).trim(),
              price: num(a.price),
              billingType: str(a.billingType),
              taxPercent: num(a.taxPercent),
              description: str(a.description),
              isActive: a.active !== undefined ? bool(a.active) : a.status ? a.status === 'Active' : true,
            });
            await Addon.findOneAndUpdate({ tenantId, addonId }, { $set: set }, MONGO_OPTS);
          }
          if (presentAddonIds.length > 0) {
            await Addon.deleteMany({ tenantId, addonId: { $nin: presentAddonIds } });
          }
        }
      }
    }

    // 7. TAX RULES
    if (key === 'hotelpms_taxes_v3' || key === 'hotelpms_taxes') {
      const taxes = safeParse(value);
      if (Array.isArray(taxes)) {
        if (taxes.length === 0) {
          await TaxRule.deleteMany({ tenantId });
        } else {
          const presentTaxIds = [];
          for (const tx of taxes) {
            if (!tx || (!tx.id && !tx.taxId && !tx.name)) continue;
            const taxId = String(tx.id || tx.taxId || tx.name).trim();
            presentTaxIds.push(taxId);
            const isFixed = String(tx.taxType || '').toLowerCase() === 'fixed';
            const set = buildSet(TaxRule, tx, {
              taxId,
              name: String(tx.name || taxId).trim(),
              code: str(tx.code) || '',
              taxType: isFixed ? 'fixed' : 'percentage',
              percent: !isFixed ? (num(pick(tx, 'percent', 'percentage', 'ratePercentage')) || 0) : 0,
              fixedAmount: isFixed ? (num(pick(tx, 'fixedAmount', 'amount')) || 0) : 0,
              fixedCalculation: isFixed ? (str(tx.fixedCalculation) || 'per_night') : '',
            });
            await TaxRule.findOneAndUpdate({ tenantId, taxId }, { $set: set }, MONGO_OPTS);
          }
          if (presentTaxIds.length > 0) {
            await TaxRule.deleteMany({ tenantId, taxId: { $nin: presentTaxIds } });
          }
        }
      }
    }

    // 8. AUDIT LOGS
    if (key === 'hotelpms_audit_logs_v1') {
      const logs = safeParse(value);
      if (Array.isArray(logs)) {
        if (logs.length === 0) {
          await AuditLog.deleteMany({ tenantId });
        } else {
          for (const l of logs) {
            if (!l || (!l.id && !l.action)) continue;
            const action = String(l.action || l.module || 'Action');
            const details = String(l.details || l.description || '');
            const timestamp = str(pick(l, 'timestamp', 'date'));
            // stable id (never random) so the same log is not inserted again on every sync
            const logId = !isEmpty(l.id)
              ? String(l.id)
              : `al_${crypto.createHash('sha1').update(`${timestamp}|${action}|${details}`).digest('hex').slice(0, 16)}`;
            const set = buildSet(AuditLog, l, {
              logId,
              action,
              details,
              user: str(pick(l, 'user', 'userName')),
              timestamp,
            });
            await AuditLog.findOneAndUpdate({ tenantId, logId }, { $set: set }, MONGO_OPTS);
          }
        }
      }
    }

    // 9. CORPORATE ACCOUNTS
    if (key === 'hotelpms_company_accounts_v1') {
      const accs = safeParse(value);
      if (Array.isArray(accs)) {
        if (accs.length === 0) {
          await CorporateAccount.deleteMany({ tenantId });
        } else {
          for (const c of accs) {
            if (!c || (!c.id && !c.companyId && !c.name)) continue;
            const companyId = String(c.id || c.companyId || c.name).trim();
            const set = buildSet(CorporateAccount, c, {
              companyId,
              name: String(c.name || companyId).trim(),
              contactPerson: str(pick(c, 'contactPerson', 'contact')),
              email: str(c.email),
              phone: str(c.phone),
              creditLimit: num(pick(c, 'creditLimit', 'limit')),
              currentBalanceDue: num(pick(c, 'currentBalanceDue', 'balance', 'due')),
              isActive: bool(c.active !== undefined ? c.active : c.isActive),
            });
            await CorporateAccount.findOneAndUpdate({ tenantId, companyId }, { $set: set }, MONGO_OPTS);
          }
        }
      }
    }

    // 10. DEPOSITS
    if (key === 'hotelpms_deposits_v1') {
      const deps = safeParse(value);
      if (Array.isArray(deps)) {
        if (deps.length === 0) {
          await Deposit.deleteMany({ tenantId });
        } else {
          for (const d of deps) {
            if (!d || (!d.id && !d.bookingId)) continue;
            const depId = String(d.id || `dep_${Date.now()}`).trim();
            const set = buildSet(Deposit, d, {
              id: depId,
              bookingId: String(d.bookingId || '').trim(),
              amount: num(pick(d, 'amount', 'amountUSD')) || 0,
              amountUSD: num(pick(d, 'amountUSD', 'amount')) || 0,
              mode: str(pick(d, 'mode', 'method')) || 'Cash',
              method: str(pick(d, 'method', 'mode')) || 'Cash',
              date: date10(pick(d, 'date', 'createdAt')) || new Date().toISOString().slice(0, 10),
              status: str(d.status) || 'held',
              note: str(pick(d, 'note', 'notes', 'description')) || 'Security Deposit',
            });
            await Deposit.findOneAndUpdate({ tenantId, id: depId }, { $set: set }, MONGO_OPTS);
          }
        }
      }
    }

    // 11. PAYMENTS
    if (key === 'hotelpms_payments_v1') {
      const pmts = safeParse(value);
      if (Array.isArray(pmts)) {
        if (pmts.length === 0) {
          await Payment.deleteMany({ tenantId });
        } else {
          for (const p of pmts) {
            if (!p || (!p.id && !p.bookingId)) continue;
            const pmtId = String(p.id || `pmt_${Date.now()}`).trim();
            const set = buildSet(Payment, p, {
              id: pmtId,
              bookingId: String(p.bookingId || '').trim(),
              type: str(p.type) || 'Payment',
              method: str(pick(p, 'method', 'mode')) || 'Cash USD',
              mode: str(pick(p, 'mode', 'method')) || 'Cash',
              amountUSD: num(pick(p, 'amountUSD', 'amount')) || 0,
              amount: num(pick(p, 'amount', 'amountUSD')) || 0,
              description: str(p.description),
              reference: str(p.reference),
              isRefund: bool(p.isRefund),
              date: date10(pick(p, 'date', 'createdAt')) || new Date().toISOString().slice(0, 10),
              recordedBy: str(pick(p, 'recordedBy', 'user')) || 'System',
            });
            await Payment.findOneAndUpdate({ tenantId, id: pmtId }, { $set: set }, MONGO_OPTS);
          }
        }
      }
    }

    // 12. NIGHT AUDIT LOGS
    if (key === 'hotelpms_night_audit_log_v1') {
      const audits = safeParse(value);
      if (Array.isArray(audits)) {
        if (audits.length === 0) {
          await NightAudit.deleteMany({ tenantId });
        } else {
          for (const na of audits) {
            if (!na || (!na.auditId && !na.id && !na.businessDateRolled)) continue;
            const auditId = String(na.auditId || na.id || `na_${Date.now()}`).trim();
            const set = buildSet(NightAudit, na, {
              auditId,
              businessDateRolled: date10(pick(na, 'businessDateRolled', 'dateRolled', 'businessDate')) || new Date().toISOString().slice(0, 10),
              previousBusinessDate: date10(pick(na, 'previousBusinessDate', 'prevDate')) || new Date().toISOString().slice(0, 10),
              totalRoomsOccupied: num(na.totalRoomsOccupied) || 0,
              totalRoomRevenue: num(na.totalRoomRevenue) || 0,
              totalTaxCollected: num(na.totalTaxCollected) || 0,
              totalPaymentsCollected: num(na.totalPaymentsCollected) || 0,
              executedBy: str(pick(na, 'executedBy', 'user')) || 'Night Auditor',
              status: str(na.status) || 'Completed',
            });
            await NightAudit.findOneAndUpdate({ tenantId, auditId }, { $set: set }, MONGO_OPTS);
          }
        }
      }
    }

    // 13. FOLIOS
    if (key === 'hotelpms_folios_v1' || key === 'hotelpms_folios_v3') {
      const foliosMap = safeParse(value);
      if (foliosMap && typeof foliosMap === 'object' && !Array.isArray(foliosMap)) {
        for (const [bookingId, fData] of Object.entries(foliosMap)) {
          if (!fData) continue;
          const items = Array.isArray(fData.items) ? fData.items : Array.isArray(fData.folioA) ? fData.folioA : [];
          const set = buildSet(Folio, fData, {
            bookingId: String(bookingId).trim(),
            folioType: str(fData.folioType) || 'folioA',
            items: items.map((it) => ({
              id: String(it.id || `item_${Date.now()}`),
              date: date10(it.date) || new Date().toISOString().slice(0, 10),
              category: str(it.category) || 'Charge',
              description: str(it.description || it.category) || 'Folio Charge',
              amountUSD: num(pick(it, 'amountUSD', 'amount')) || 0,
              amount: num(pick(it, 'amount', 'amountUSD')) || 0,
              quantity: num(it.quantity) || 1,
              isTaxExempt: bool(it.isTaxExempt),
              isDiscount: bool(it.isDiscount),
              taxAmount: num(it.taxAmount) || 0,
            })),
          });
          await Folio.findOneAndUpdate({ tenantId, bookingId: String(bookingId).trim() }, { $set: set }, MONGO_OPTS);
        }
      }
    }

    // 14. MISC TRANSACTIONS
    if (
      key === 'pms_misc_transactions' ||
      key === 'hotelpms_misc_transactions_v1' ||
      key === 'hotelpms_misc_transactions' ||
      key === 'pms_misc_transactions_v1'
    ) {
      const txs = safeParse(value);
      if (Array.isArray(txs)) {
        if (txs.length === 0) {
          await MiscTransaction.deleteMany({ tenantId });
        } else {
          for (const t of txs) {
            if (!t || (!t.seqId && !t.id && !t.itemName)) continue;
            const seqId = String(t.seqId || t.id || `MSC-${Date.now()}`).trim();
            const set = buildSet(MiscTransaction, t, {
              seqId,
              id: String(t.id || seqId).trim(),
              date: date10(pick(t, 'date', 'createdAt')) || new Date().toISOString().slice(0, 10),
              time: str(t.time) || '',
              type: String(t.type || 'SALE').toUpperCase().trim(),
              category: str(pick(t, 'category', 'typeCategory')) || 'Misc / Other',
              itemName: str(pick(t, 'itemName', 'item', 'description', 'name')) || 'Item',
              amountUSD: num(pick(t, 'amountUSD', 'amount', 'totalUSD')) || 0,
              settlement: str(pick(t, 'settlement', 'mode', 'method')) || 'Cash',
              roomNumber: str(pick(t, 'roomNumber', 'roomNo', 'room')) || 'N/A',
              guestName: str(pick(t, 'guestName', 'guest')) || 'N/A',
              bookingId: t.bookingId ? String(t.bookingId).trim() : null,
              recordedBy: str(pick(t, 'recordedBy', 'user')) || 'System',
              notes: str(pick(t, 'notes', 'note', 'description')) || '',
              isDeleted: bool(t.isDeleted) || false,
            });
            await MiscTransaction.findOneAndUpdate({ tenantId, seqId }, { $set: set }, MONGO_OPTS);
          }
        }
      }
    }
  } catch (err) {
    console.error(`[syncStructuredModels] Error syncing key "${key}":`, err.message);
  }
}

// Startup job: (1) old mirror documents that have no hotel yet are assigned to the default hotel,
// (2) indexes are rebuilt so uniqueness is per hotel (room "101" can exist in every hotel),
// (3) every hotel's saved entries are mirrored again so the collections are clean.
async function migrateAndResync() {
  const StoreEntry = require('../models/StoreEntry');
  const Tenant = require('../models/Tenant');
  const def = (await Tenant.findOne({ isDefault: true }).lean())?.tenantId || 'default';
  const names = ['Addon', 'AuditLog', 'Booking', 'Deposit', 'Guest', 'NightAudit', 'Payment', 'Property', 'RatePlan', 'Room', 'RoomType', 'TaxRule', 'Folio', 'CorporateAccount', 'MiscTransaction'];
  for (const n of names) {
    const M = require(`../models/${n}`);
    try {
      await M.collection.updateMany({ tenantId: { $exists: false } }, { $set: { tenantId: def } });
      await M.syncIndexes();
    } catch (e) {
      console.error(`migrate ${n} failed:`, e.message);
    }
  }
  const keys = ['hotelpms_hotel_info_v3', 'hotelpms_room_types_v3', 'pms_misc_transactions', 'hotelpms_misc_transactions_v1', 'hotelpms_misc_transactions'];
  const docs = await StoreEntry.find({ key: { $in: keys } }).lean();
  for (const d of docs) await syncStructuredModels(d.tenantId, d.key, d.value);
}

module.exports = { syncStructuredModels, migrateAndResync, resyncCleanMirror: migrateAndResync };
