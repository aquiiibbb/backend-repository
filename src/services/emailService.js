const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const EmailLog = require('../models/EmailLog');
const StoreEntry = require('../models/StoreEntry');
const Tenant = require('../models/Tenant');

// ---------------------------------------------------------------------------------------------
// Email for the whole system.
//  * "builtin" (default): sent through Ahaalo's AWS SES account (backend/.env -> AWS_SES_*).
//    The mail is sent AS "<Hotel name> <support@ahaalo.com>" and replies go to the hotel's own address.
//  * "custom_smtp": the hotel's own SMTP server (saved in its Notifications settings).
// Secrets only ever come from the environment (.env), never from source code.
// ---------------------------------------------------------------------------------------------

const LOGO_PATH = path.join(__dirname, '..', '..', 'assets', 'logo.png');
const LOGO_CID = 'ahaalo-logo@ahaalo';

const KEYS = {
  hotelInfo: 'hotelpms_hotel_info_v3',
  emailConfig: 'hotelpms_email_config_v1',
  guest: 'hotelpms_guest_notifications_v1',
  hotelier: 'hotelpms_hotelier_notifications_v1',
  bookings: 'hotelpms_bookings_v1',
};

const DEFAULT_GUEST_NOTIFICATIONS = {
  confirmation: {
    enabled: true,
    attachVoucher: false,
    subject: 'Booking Confirmed - {BookingID} | {HotelName}',
    body:
      'Dear {GuestName},\n\nThank you for choosing {HotelName}! Your reservation is confirmed.\n\nBooking ID: {BookingID}\nCheck-in: {CheckInDate}\nCheck-out: {CheckOutDate}\nRoom: {RoomType}\nTotal: {TotalAmount}\n\nIf you need any help, call us on {HotelPhone}.\n\nWe look forward to welcoming you!\n{HotelName}\n{HotelAddress}',
  },
  checkIn: {
    enabled: true,
    subject: 'Welcome to {HotelName} - Check-in successful',
    body:
      'Dear {GuestName},\n\nYour check-in at {HotelName} was successful. Welcome!\n\nBooking ID: {BookingID}\nRoom: {RoomNumber} ({RoomType})\nCheck-out: {CheckOutDate}\n\nFor anything you need during your stay, call us on {HotelPhone}.\n\nEnjoy your stay!\n{HotelName}',
  },
  preArrival: {
    enabled: false,
    leadDays: 2,
    subject: 'Your stay at {HotelName} starts soon',
    body:
      'Dear {GuestName},\n\nWe are looking forward to your arrival on {CheckInDate}.\n\nBooking ID: {BookingID}\nRoom: {RoomType}\n\nNeed anything before you arrive? Call us on {HotelPhone}.\n\nSee you soon,\n{HotelName}',
  },
  checkOut: {
    enabled: true,
    attachFolio: false,
    subject: 'Thank you for staying with {HotelName}',
    body:
      'Dear {GuestName},\n\nThank you for staying with us. Your check-out is complete.\n\nBooking ID: {BookingID}\nTotal: {TotalAmount}\n\nWe hope to see you again soon!\n{HotelName}',
  },
  cancellation: {
    enabled: true,
    subject: 'Reservation Cancelled - {BookingID} | {HotelName}',
    body:
      'Dear {GuestName},\n\nYour reservation {BookingID} ({CheckInDate} to {CheckOutDate}) has been cancelled.\n\nIf this was a mistake or you would like to book again, please contact us on {HotelPhone}.\n\n{HotelName}',
  },
};

const DEFAULT_HOTELIER_NOTIFICATIONS = { staffEmails: '', alertNewDirectBooking: true, alertNewOtaBooking: true, alertCancellation: true, alertNoShow: false };

const GUEST_EVENTS = ['confirmation', 'checkIn', 'checkOut', 'cancellation', 'preArrival'];

// ------------------------------------------------------------------ small helpers
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;
const isEmail = (v) => typeof v === 'string' && EMAIL_RE.test(v.trim()) && v.length <= 254;
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const oneLine = (v) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 300);
const parse = (raw) => {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};
const fmtDay = (d) => {
  if (!d) return '';
  const dt = new Date(`${String(d).slice(0, 10)}T00:00:00`);
  return Number.isNaN(dt.getTime()) ? String(d) : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

function platformConfigured() {
  const e = process.env;
  return Boolean(e.AWS_SES_HOST && e.AWS_SES_USER && e.AWS_SES_PASS && e.AWS_SES_FROM_EMAIL);
}

const transports = new Map();
function getTransport(opts) {
  const key = JSON.stringify([opts.host, opts.port, opts.secure, opts.auth?.user, opts.requireTLS]);
  if (!transports.has(key)) transports.set(key, nodemailer.createTransport({ ...opts, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000 }));
  return transports.get(key);
}
function platformTransport() {
  const port = Number(process.env.AWS_SES_PORT) || 587;
  return getTransport({
    host: process.env.AWS_SES_HOST,
    port,
    secure: port === 465,
    requireTLS: port !== 465 && String(process.env.AWS_SES_REQUIRE_TLS || 'true').toLowerCase() !== 'false',
    auth: { user: process.env.AWS_SES_USER, pass: process.env.AWS_SES_PASS },
  });
}
function customTransport(c) {
  const port = Number(c.smtpPort) || 587;
  const sec = String(c.security || 'TLS').toUpperCase();
  return getTransport({
    host: c.smtpHost,
    port,
    secure: sec === 'SSL' || port === 465,
    requireTLS: sec === 'TLS',
    auth: c.smtpUser ? { user: c.smtpUser, pass: c.smtpPass || '' } : undefined,
  });
}

const isAuthError = (err) => err?.code === 'EAUTH' || err?.responseCode === 535 || /\b535\b|authentication credentials invalid/i.test(String(err?.response || err?.message || ''));

// Logs in to AWS SES without sending anything (used by `npm run check:email` and at server start)
async function verifyPlatform() {
  if (!platformConfigured()) return { ok: false, error: 'AWS_SES_* is not set in backend/.env' };
  try {
    await platformTransport().verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: isAuthError(err) ? '535 Authentication Credentials Invalid - the SES SMTP username/password is wrong (create new SMTP credentials in the SES console and copy-paste them)' : String(err?.message || err).slice(0, 200) };
  }
}

async function readKey(tenantId, key) {
  const doc = await StoreEntry.findOne({ tenantId, key }).lean();
  return doc ? parse(doc.value) : undefined;
}

// What the hotel looks like in emails (name, phone, address, currency symbol, own email)
async function hotelProfile(tenantId) {
  const [info, tenant] = await Promise.all([readKey(tenantId, KEYS.hotelInfo), Tenant.findOne({ tenantId }).lean()]);
  const i = info && typeof info === 'object' ? info : {};
  const phone = typeof i.phone === 'object' && i.phone ? [i.phone.dialCode, i.phone.number].filter(Boolean).join(' ') : i.phone || i.contactName || tenant?.phone || '';
  const address = [i.address, i.city, i.state, i.zipcode].filter(Boolean).join(', ');
  const sym = String(i.currency?.symbol || (String(i.currency || '').match(/\(([^)]+)\)\s*$/) || [])[1] || tenant?.currency || '$');
  return { name: i.name || i.propertyName || tenant?.name || 'Our Hotel', phone: String(phone || ''), address, symbol: sym, email: i.email || tenant?.ownerEmail || '' };
}

// {GuestName} style tags -> values (all values escaped later, once, when the HTML is built)
function tagValues(booking, hotel) {
  const b = booking || {};
  const total = Number(b.totalAmount);
  return {
    GuestName: b.guest || b.guestName || b.fullName || 'Guest',
    BookingID: b.id || b.bookingId || '',
    CheckInDate: fmtDay(b.checkIn || b.checkInDate),
    CheckOutDate: fmtDay(b.checkOut || b.checkOutDate),
    RoomType: b.roomType || b.room || '',
    RoomNumber: b.room || b.roomNumber || '',
    Nights: b.nights ?? '',
    TotalAmount: Number.isFinite(total) ? `${hotel.symbol}${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '',
    HotelName: hotel.name,
    HotelPhone: hotel.phone,
    HotelAddress: hotel.address,
  };
}
const fill = (tpl, vals) => String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (k in vals ? String(vals[k]) : m));

// ------------------------------------------------------------------ branded HTML
function layoutHtml({ title, bodyText, rows = [], hotel, footerNote }) {
  const body = esc(bodyText).replace(/\n/g, '<br>');
  const table = rows.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:18px 0 6px;border:1px solid #e2e8f0;border-radius:10px;border-collapse:separate;overflow:hidden">${rows
        .filter(([, v]) => v !== '' && v !== undefined && v !== null)
        .map(([k, v]) => `<tr><td style="padding:9px 14px;background:#f8fafc;color:#64748b;font-size:12px;font-weight:700;text-transform:uppercase;width:38%;border-bottom:1px solid #e2e8f0">${esc(k)}</td><td style="padding:9px 14px;color:#0f172a;font-size:14px;font-weight:600;border-bottom:1px solid #e2e8f0">${esc(v)}</td></tr>`)
        .join('')}</table>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0">
<tr><td align="center" style="padding:22px 24px 10px;background:#ffffff"><img src="cid:${LOGO_CID}" alt="Ahaalo" width="150" style="display:block;border:0;max-width:150px;height:auto"></td></tr>
<tr><td align="center" style="padding:0 24px 14px;color:#0f172a;font-size:18px;font-weight:800">${esc(hotel?.name || '')}</td></tr>
<tr><td style="height:3px;background:#f59e0b;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:24px 28px;color:#1e293b;font-size:15px;line-height:1.65">${body}${table}</td></tr>
<tr><td style="padding:16px 28px 22px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;line-height:1.6;text-align:center">${esc(footerNote || '')}${footerNote ? '<br>' : ''}Sent through Ahaalo Hotel PMS</td></tr>
</table></td></tr></table></body></html>`;
}

const logoAttachment = () => (fs.existsSync(LOGO_PATH) ? [{ filename: 'ahaalo-logo.png', path: LOGO_PATH, cid: LOGO_CID, contentDisposition: 'inline' }] : []);

// ------------------------------------------------------------------ limits + log
const startOfDay = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

async function log(entry) {
  try {
    await EmailLog.create(entry);
  } catch {
    /* logging must never break sending */
  }
}

async function checkLimits(tenantId, to) {
  const tenant = await Tenant.findOne({ tenantId }).lean();
  if (tenant && tenant.emailEnabled === false) return 'email_disabled';
  const limit = tenant?.emailDailyLimit ?? 300;
  const sentToday = await EmailLog.countDocuments({ tenantId, status: 'sent', createdAt: { $gte: startOfDay() } });
  if (sentToday >= limit) return 'daily_limit';
  const toSame = await EmailLog.countDocuments({ tenantId, to: String(to).toLowerCase(), status: 'sent', createdAt: { $gte: startOfDay() } });
  if (toSame >= 6) return 'recipient_limit';
  return null;
}

// Low level: send ONE mail for a hotel using its chosen gateway
async function deliver({ tenantId, type, bookingId = '', to, subject, html, text, config, hotel, attachments = [] }) {
  const cfg = config || {};
  const custom = cfg.sendingMode === 'custom_smtp' && cfg.smtpHost;
  if (!custom && !platformConfigured()) {
    return { ok: false, status: 'failed', reason: 'not_configured', error: 'The Ahaalo email service (AWS SES) is not configured on the server.' };
  }
  const fromName = oneLine(cfg.fromName || hotel?.name || 'Ahaalo');
  const replyTo = [cfg.replyTo, cfg.fromEmail, hotel?.email].find(isEmail);
  const from = custom ? `"${fromName.replace(/"/g, '')}" <${isEmail(cfg.fromEmail) ? cfg.fromEmail : cfg.smtpUser}>` : `"${fromName.replace(/"/g, '')}" <${process.env.AWS_SES_FROM_EMAIL}>`;
  try {
    const info = await (custom ? customTransport(cfg) : platformTransport()).sendMail({
      from,
      to,
      replyTo: replyTo || undefined,
      subject: oneLine(subject),
      html,
      text,
      attachments: [...logoAttachment(), ...attachments],
    });
    await log({ tenantId, type, bookingId: String(bookingId || ''), to: String(to).toLowerCase(), subject: oneLine(subject), status: 'sent', messageId: String(info.messageId || '') });
    return { ok: true, status: 'sent', to, messageId: info.messageId };
  } catch (err) {
    const msg = String(err?.response || err?.message || err).slice(0, 300);
    await log({ tenantId, type, bookingId: String(bookingId || ''), to: String(to).toLowerCase(), subject: oneLine(subject), status: 'failed', error: msg });
    if (isAuthError(err)) {
      console.error(`✉️  Email login rejected (${custom ? 'hotel SMTP' : 'AWS SES'}): ${msg}`);
      return { ok: false, status: 'failed', reason: 'auth_failed', error: custom ? 'Your SMTP username or password was rejected by the mail server. Check the email server setup.' : 'The Ahaalo email service could not log in to AWS SES (wrong username/password in backend/.env). Please tell the administrator.' };
    }
    return { ok: false, status: 'failed', reason: 'send_failed', error: msg };
  }
}

// ------------------------------------------------------------------ guest mails
async function loadSettings(tenantId) {
  const [config, guest, hotelier] = await Promise.all([readKey(tenantId, KEYS.emailConfig), readKey(tenantId, KEYS.guest), readKey(tenantId, KEYS.hotelier)]);
  const g = guest && typeof guest === 'object' ? guest : {};
  const merged = {};
  for (const k of Object.keys(DEFAULT_GUEST_NOTIFICATIONS)) merged[k] = { ...DEFAULT_GUEST_NOTIFICATIONS[k], ...(g[k] || {}) };
  return { config: config && typeof config === 'object' ? config : {}, guest: merged, hotelier: { ...DEFAULT_HOTELIER_NOTIFICATIONS, ...(hotelier && typeof hotelier === 'object' ? hotelier : {}) } };
}

const SUMMARY_EVENTS = new Set(['confirmation', 'checkIn', 'checkOut', 'preArrival']);

// Result: { ok, status: 'sent' | 'skipped' | 'failed', reason?, to?, error? }
async function sendGuestEmail(tenantId, event, booking, { force = false } = {}) {
  if (!GUEST_EVENTS.includes(event)) return { ok: false, status: 'skipped', reason: 'unknown_event' };
  const to = String(booking?.email || booking?.guestEmail || '').trim();
  if (!isEmail(to)) return { ok: true, status: 'skipped', reason: 'no_guest_email' };
  const bookingId = String(booking?.id || booking?.bookingId || '');

  const { config, guest } = await loadSettings(tenantId);
  const tpl = guest[event];
  if (!tpl || tpl.enabled === false) return { ok: true, status: 'skipped', reason: 'disabled' };

  // (same booking id AND same guest address: after a data reset booking numbers start again, a new guest must still get a mail)
  if (!force && bookingId && (await EmailLog.exists({ tenantId, type: event, bookingId, to: to.toLowerCase(), status: 'sent' }))) {
    return { ok: true, status: 'skipped', reason: 'already_sent' };
  }
  const limited = await checkLimits(tenantId, to);
  if (limited) return { ok: false, status: 'skipped', reason: limited };

  const hotel = await hotelProfile(tenantId);
  const vals = tagValues(booking, hotel);
  const subject = fill(tpl.subject, vals);
  const bodyText = fill(tpl.body, vals);
  const rows = SUMMARY_EVENTS.has(event)
    ? [['Booking ID', vals.BookingID], ['Check-in', vals.CheckInDate], ['Check-out', vals.CheckOutDate], ['Room', vals.RoomType], ['Total', event === 'preArrival' ? '' : vals.TotalAmount]]
    : [];
  const html = layoutHtml({ title: subject, bodyText, rows, hotel, footerNote: [hotel.name, hotel.address, hotel.phone].filter(Boolean).join(' • ') });
  return deliver({ tenantId, type: event, bookingId, to, subject, html, text: bodyText, config, hotel });
}

// ------------------------------------------------------------------ staff alerts
const ALERT_FLAGS = { newDirectBooking: 'alertNewDirectBooking', newOtaBooking: 'alertNewOtaBooking', cancellation: 'alertCancellation', noShow: 'alertNoShow' };
const ALERT_TITLE = { newDirectBooking: 'New booking', newOtaBooking: 'New OTA booking', cancellation: 'Booking cancelled', noShow: 'Guest no-show' };

const isOta = (b) => /ota|booking\.com|expedia|agoda|airbnb|channel/i.test(`${b?.source || ''} ${b?.segment || ''} ${b?.subSegment || ''}`);

async function sendStaffAlert(tenantId, kind, booking) {
  const flag = ALERT_FLAGS[kind];
  if (!flag) return { ok: false, status: 'skipped', reason: 'unknown_event' };
  const { config, hotelier } = await loadSettings(tenantId);
  if (!hotelier[flag]) return { ok: true, status: 'skipped', reason: 'disabled' };
  const recipients = String(hotelier.staffEmails || '').split(/[,;\s]+/).filter(isEmail).slice(0, 10);
  if (!recipients.length) return { ok: true, status: 'skipped', reason: 'no_staff_emails' };
  const bookingId = String(booking?.id || '');
  const type = `alert_${kind}`;
  const hotel = await hotelProfile(tenantId);
  const v = tagValues(booking, hotel);
  const subject = `${ALERT_TITLE[kind]}: ${v.GuestName} (${v.BookingID})`;
  if (bookingId && (await EmailLog.exists({ tenantId, type, bookingId, subject: oneLine(subject), status: 'sent' }))) return { ok: true, status: 'skipped', reason: 'already_sent' };
  const bodyText = `${ALERT_TITLE[kind]} at ${hotel.name}.`;
  const rows = [['Guest', v.GuestName], ['Booking ID', v.BookingID], ['Room', v.RoomType], ['Check-in', v.CheckInDate], ['Check-out', v.CheckOutDate], ['Total', v.TotalAmount], ['Source', booking?.source || '']];
  const html = layoutHtml({ title: subject, bodyText, rows, hotel, footerNote: 'Internal alert for hotel staff' });
  let sent = 0;
  let lastErr = '';
  for (const to of recipients) {
    if (await checkLimits(tenantId, to)) continue;
    const r = await deliver({ tenantId, type, bookingId, to, subject, html, text: bodyText, config, hotel });
    if (r.ok) sent += 1;
    else lastErr = r.error;
  }
  return sent ? { ok: true, status: 'sent', to: `${sent} staff` } : { ok: false, status: 'failed', reason: 'send_failed', error: lastErr || 'limit reached' };
}

// Everything that should go out when something happens to a booking (called by the app / public routes)
async function handleBookingEvent(tenantId, event, booking, opts) {
  const out = { guest: { ok: true, status: 'skipped', reason: 'n/a' }, staff: null };
  if (GUEST_EVENTS.includes(event)) out.guest = await sendGuestEmail(tenantId, event, booking, opts);
  const alertKind = event === 'confirmation' ? (isOta(booking) ? 'newOtaBooking' : 'newDirectBooking') : event === 'cancellation' ? 'cancellation' : event === 'noShow' ? 'noShow' : null;
  if (alertKind) out.staff = await sendStaffAlert(tenantId, alertKind, booking).catch((e) => ({ ok: false, status: 'failed', error: String(e.message) }));
  return out;
}

// ------------------------------------------------------------------ test mail (Notifications settings)
async function sendTestEmail(tenantId, to, configOverride) {
  if (!isEmail(to)) return { ok: false, status: 'failed', reason: 'bad_address', error: 'Enter a valid email address.' };
  const limited = await checkLimits(tenantId, to);
  if (limited) return { ok: false, status: 'skipped', reason: limited, error: limited === 'daily_limit' ? 'Daily email limit reached for this hotel.' : 'Email is turned off for this hotel.' };
  const saved = (await loadSettings(tenantId)).config;
  const config = { ...saved, ...(configOverride && typeof configOverride === 'object' ? configOverride : {}) };
  const hotel = await hotelProfile(tenantId);
  const subject = `Test email from ${hotel.name}`;
  const bodyText = `This is a test email from ${hotel.name}.\n\nIf you can read this, your email setup is working and booking emails will reach your guests.`;
  const html = layoutHtml({ title: subject, bodyText, hotel, footerNote: 'Test message' });
  return deliver({ tenantId, type: 'test', to, subject, html, text: bodyText, config, hotel });
}

// ------------------------------------------------------------------ login details for a new hotel owner (Super Admin)
async function sendCredentialsEmail({ tenantId = '', hotelCode = '', to, hotelName, ownerName, username, email, password, loginUrl, isReset = false }) {
  if (!isEmail(to)) return { ok: false, status: 'failed', reason: 'bad_address', error: `"${to}" is not a valid email address.` };
  const hotel = { name: hotelName || 'Your hotel' };
  const subject = isReset ? `Your new password for ${hotel.name} - Ahaalo PMS` : `Welcome to Ahaalo PMS - your login for ${hotel.name}`;
  const bodyText = `Dear ${ownerName || 'Hotel Owner'},\n\n${isReset ? `The password for ${hotel.name} has been reset.` : `Your hotel "${hotel.name}" is ready on Ahaalo PMS.`} Use the details below to log in.\n\nPlease change the password after your first login.`;
  const codeDisp = hotelCode || tenantId;
  const rows = [['Hotel Code / ID', codeDisp], ['Login page', loginUrl], ['Username / Email', email || username], ['Password', password]];
  const html = layoutHtml({ title: subject, bodyText, rows, hotel, footerNote: 'Keep this email private. Anyone with these details can open your hotel account.' });
  const text = `${bodyText}\n\nHotel Code / ID: ${codeDisp}\nLogin page: ${loginUrl}\nUsername / Email: ${email || username}\nPassword: ${password}`;
  return deliver({ tenantId, type: 'credentials', to, subject, html, text, config: {}, hotel: { ...hotel, email: '' } });
}

// ------------------------------------------------------------------ pre-arrival reminders (run by the scheduler)
async function runPreArrivalReminders() {
  const tenants = await Tenant.find({ status: { $in: ['active', 'trialing'] } }).lean();
  let sent = 0;
  for (const t of tenants) {
    try {
      const { guest } = await loadSettings(t.tenantId);
      if (!guest.preArrival?.enabled) continue;
      const lead = Number(guest.preArrival.leadDays) || 2;
      const target = new Date(Date.now() + lead * 86400000).toISOString().slice(0, 10);
      const list = await readKey(t.tenantId, KEYS.bookings);
      if (!Array.isArray(list)) continue;
      for (const b of list) {
        if (String(b.checkIn || '').slice(0, 10) !== target) continue;
        if (!['confirmed', 'pending', 'reserved'].includes(String(b.status || '').toLowerCase())) continue;
        const r = await sendGuestEmail(t.tenantId, 'preArrival', b);
        if (r.status === 'sent') sent += 1;
      }
    } catch (e) {
      console.error(`pre-arrival reminders failed for ${t.tenantId}:`, e.message);
    }
  }
  return sent;
}

let timer = null;
function startScheduler() {
  if (timer || String(process.env.DISABLE_EMAIL_SCHEDULER).toLowerCase() === 'true') return;
  // every 3 hours; each booking gets its reminder only once (see "already_sent")
  timer = setInterval(() => runPreArrivalReminders().catch((e) => console.error('pre-arrival job:', e.message)), 3 * 60 * 60 * 1000);
  if (timer.unref) timer.unref();
}

module.exports = {
  platformConfigured,
  verifyPlatform,
  isEmail,
  DEFAULT_GUEST_NOTIFICATIONS,
  GUEST_EVENTS,
  sendGuestEmail,
  sendStaffAlert,
  handleBookingEvent,
  sendTestEmail,
  sendCredentialsEmail,
  runPreArrivalReminders,
  startScheduler,
};
