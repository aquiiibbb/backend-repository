const express = require('express');
const { resolvePublicTenant } = require('../middleware/tenantAuth');
const store = require('../services/storeService');
const StoreEntry = require('../models/StoreEntry');
const { isPublicReadKey, BOOKINGS_KEY } = require('../config/storeKeys');
const emailService = require('../services/emailService');

const router = express.Router();
router.use(resolvePublicTenant);

const INACTIVE = new Set(['cancelled', 'canceled', 'checked-out', 'no-show', 'void', 'deleted']);
const roomOf = (b) => String(b.room || b.roomNo || '').trim();
const day = (v) => String(v || '').substring(0, 10);

async function loadBookings(tenantId) {
  const doc = await StoreEntry.findOne({ tenantId, key: BOOKINGS_KEY }).lean();
  try {
    const v = JSON.parse(doc?.value || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// GET /api/public/snapshot?hotel=<id>&booking=<reservationId>
// Public data needed by the booking engine / self check-in page. Other guests' bookings are reduced to availability only.
router.get('/snapshot', async (req, res, next) => {
  try {
    const { entries } = await store.getAll(req.tenantId);
    const out = {};
    for (const [key, e] of Object.entries(entries)) if (isPublicReadKey(key)) out[key] = e.value;

    const wantedId = String(req.query.booking || '');
    const bookings = await loadBookings(req.tenantId);
    out[BOOKINGS_KEY] = JSON.stringify(
      bookings.map((b) => {
        const id = String(b.id || b._id || '');
        if (wantedId && id === wantedId) return b;
        return {
          id,
          room: b.room,
          roomNo: b.roomNo,
          roomType: b.roomType,
          roomTypeId: b.roomTypeId,
          checkIn: b.checkIn,
          checkOut: b.checkOut,
          status: b.status,
          guest: 'Reserved',
        };
      })
    );
    res.json({ success: true, tenantId: req.tenantId, entries: out });
  } catch (err) {
    next(err);
  }
});

// POST /api/public/bookings  - Booking Engine creates a reservation
router.post('/bookings', async (req, res, next) => {
  try {
    const b = req.body && req.body.booking;
    if (!b || typeof b !== 'object') return res.status(400).json({ success: false, message: 'booking is required' });
    const id = String(b.id || b._id || '').slice(0, 64);
    if (!id || !roomOf(b) || !day(b.checkIn) || !day(b.checkOut) || !(b.guest || b.guestName)) {
      return res.status(400).json({ success: false, message: 'Missing guest, room or dates' });
    }
    if (JSON.stringify(b).length > 400_000) return res.status(413).json({ success: false, message: 'Payload too large' });

    const list = await loadBookings(req.tenantId);
    if (list.some((x) => String(x.id || x._id) === id)) return res.json({ success: true, duplicate: true });

    const room = roomOf(b);
    const ci = day(b.checkIn);
    const co = day(b.checkOut);
    const clash = list.some(
      (x) => roomOf(x) === room && !INACTIVE.has(String(x.status || '').toLowerCase()) && day(x.checkIn) < co && day(x.checkOut) > ci
    );
    if (clash) return res.status(409).json({ success: false, message: 'This room was just booked by someone else. Please choose another room or dates.' });

    const status = ['confirmed', 'pending', 'reserved'].includes(String(b.status || '').toLowerCase()) ? b.status : 'confirmed';
    list.push({ ...b, status });
    await store.writeKey(req.tenantId, BOOKINGS_KEY, JSON.stringify(list));
    res.status(201).json({ success: true });
    // confirmation mail to the guest (+ alert to staff) - after the answer, never blocks or breaks the booking
    emailService.handleBookingEvent(req.tenantId, 'confirmation', { ...b, status }).catch((e) => console.error('booking email failed:', e.message));
  } catch (err) {
    next(err);
  }
});

const CHECKIN_FIELDS = [
  'guest', 'phone', 'email', 'address', 'city', 'idType', 'idNumber', 'room',
  'digitalSignature', 'signature', 'signatureOnFile', 'notes',
];

// POST /api/public/bookings/:id/self-checkin - Guest completes contactless check-in (only touches guest/ID fields + status)
router.post('/bookings/:id/self-checkin', async (req, res, next) => {
  try {
    const list = await loadBookings(req.tenantId);
    const idx = list.findIndex((x) => String(x.id || x._id) === req.params.id);
    if (idx < 0) return res.status(404).json({ success: false, message: 'Reservation not found' });
    const current = list[idx];
    const st = String(current.status || '').toLowerCase();
    if (!['confirmed', 'pending', 'reserved', 'checked-in'].includes(st)) {
      return res.status(409).json({ success: false, message: 'This reservation cannot be checked in online.' });
    }
    const patch = {};
    for (const f of CHECKIN_FIELDS) if (req.body[f] !== undefined) patch[f] = req.body[f];
    const wasCheckedIn = st === 'checked-in';
    list[idx] = { ...current, ...patch, status: 'checked-in' };
    await store.writeKey(req.tenantId, BOOKINGS_KEY, JSON.stringify(list));
    res.json({ success: true });
    if (!wasCheckedIn) emailService.handleBookingEvent(req.tenantId, 'checkIn', list[idx]).catch((e) => console.error('check-in email failed:', e.message));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
