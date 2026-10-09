const express = require('express');
const { requireTenant, rateLimit } = require('../middleware/tenantAuth');
const email = require('../services/emailService');

// Hotel staff (logged in) -> emails. The text of every mail comes from the hotel's saved templates on the server,
// and guest mails can only go to the address written on the booking, so this cannot be used to send free-text mail.
const router = express.Router();
router.use(requireTenant);
router.use(rateLimit({ windowMs: 60_000, max: 120 }));

const EVENTS = new Set([...email.GUEST_EVENTS.filter((e) => e !== 'preArrival'), 'noShow']);

// Is the Ahaalo email service ready? (the settings page shows this honestly)
router.get('/status', (req, res) => res.json({ success: true, platformConfigured: email.platformConfigured() }));

// A booking changed -> send the matching guest mail / staff alert
router.post('/event', async (req, res, next) => {
  try {
    const { event, booking, force } = req.body || {};
    if (!EVENTS.has(event)) return res.status(400).json({ success: false, message: 'Unknown event' });
    if (!booking || typeof booking !== 'object') return res.status(400).json({ success: false, message: 'booking is required' });
    const result = await email.handleBookingEvent(req.tenantId, event, booking, { force: Boolean(force) });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

// "Send Test Email" on the Notifications settings page
router.post('/test', rateLimit({ windowMs: 60_000, max: 6 }), async (req, res, next) => {
  try {
    const { to, config } = req.body || {};
    const result = await email.sendTestEmail(req.tenantId, String(to || '').trim(), config);
    res.status(result.ok ? 200 : 400).json({ success: result.ok, ...result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
