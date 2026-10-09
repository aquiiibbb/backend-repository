// Runs against a THROWAWAY database + a local fake SMTP server (nothing is sent to the internet). Example:
//   TEST_MONGODB_URI=mongodb://127.0.0.1:27017/ahaalo_test npm run test:email
const TEST_URI = process.env.TEST_MONGODB_URI || '';
if (!/\/[^/?]*_test(\?|$)/.test(TEST_URI)) {
  console.error('Set TEST_MONGODB_URI to a database whose name ends with _test (it will be dropped).');
  process.exit(2);
}
const { SMTPServer } = require('smtp-server');
const { simpleParser } = require('mailparser');
const mailbox = [];
const smtp = new SMTPServer({
  authOptional: false, allowInsecureAuth: true, disabledCommands: ['STARTTLS'],
  onAuth(auth, session, cb) { return auth.username === 'smtp-user' && auth.password === 'smtp-pass' ? cb(null, { user: 1 }) : cb(new Error('Invalid login')); },
  onData(stream, session, cb) { simpleParser(stream, { skipImageLinks: true }).then((m) => { mailbox.push(m); cb(); }).catch(cb); },
});
process.env.MONGODB_URI = TEST_URI;
process.env.JWT_SECRET = 't'; process.env.SUPERADMIN_USERNAME = 'sa'; process.env.SUPERADMIN_PASSWORD = 'sapass';
process.env.AWS_SES_HOST = '127.0.0.1'; process.env.AWS_SES_PORT = '2525'; process.env.AWS_SES_REQUIRE_TLS = 'false';
process.env.AWS_SES_USER = 'smtp-user'; process.env.AWS_SES_PASS = 'smtp-pass'; process.env.AWS_SES_FROM_EMAIL = 'support@ahaalo.com';
process.env.HOTEL_APP_URL = 'https://app.ahaalo.test';
const mongoose = require('mongoose');
const app = require('../src/app');
const email = require('../src/services/emailService');
const { bootstrapDefaultTenant } = require('../src/services/tenantBootstrap');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const lastTo = (addr) => [...mailbox].reverse().find((m) => (m.to?.value || []).some((a) => a.address === addr));

(async () => {
  await new Promise((r) => smtp.listen(2525, '127.0.0.1', r));
  await mongoose.connect(TEST_URI); await mongoose.connection.dropDatabase(); await bootstrapDefaultTenant();
  const srv = app.listen(0); const port = srv.address().port;
  const call = async (m, p, b, tok, headers = {}) => { const r = await fetch(`http://127.0.0.1:${port}/api${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}), ...headers }, body: b ? JSON.stringify(b) : undefined }); let j; try { j = await r.json(); } catch { j = null; } return { s: r.status, j }; };
  const sa = (await call('POST', '/superadmin/login', { username: 'sa', password: 'sapass' })).j.token;

  // ---------- Super Admin: login details go straight to the owner ----------
  const A = await call('POST', '/superadmin/tenants', { name: 'Hotel Alpha', ownerName: 'Asha Owner', ownerEmail: 'asha@alpha.com' }, sa);
  ok('hotel created and API says the email was sent', A.s === 201 && A.j.email?.sent === true && A.j.email.to === 'asha@alpha.com', JSON.stringify(A.j.email));
  const m1 = lastTo('asha@alpha.com');
  ok('owner received the login email', !!m1 && /Hotel Alpha/.test(m1.subject), m1 && m1.subject);
  ok('email contains login page, username and the exact password', m1 && m1.text.includes('https://app.ahaalo.test/login') && m1.text.includes('asha@alpha.com') && m1.text.includes(A.j.adminCredentials.password), m1 && m1.text);
  ok('sent from support@ahaalo.com', m1 && m1.from.value[0].address === 'support@ahaalo.com');
  ok('Ahaalo logo is inside the email (inline image)', m1 && m1.html.includes('cid:ahaalo-logo@ahaalo') && m1.attachments.some((a) => a.contentId === '<ahaalo-logo@ahaalo>' && a.contentType === 'image/png' && a.size > 5000), JSON.stringify(m1 && m1.attachments.map((a) => [a.contentId, a.size])));
  const loginWorks = await call('POST', '/session/login', { username: 'asha@alpha.com', password: A.j.adminCredentials.password });
  ok('the emailed email+password really logs in', loginWorks.s === 200);
  const rp = await call('POST', `/superadmin/tenants/${A.j.tenant._id}/reset-password`, {}, sa);
  const m2 = lastTo('asha@alpha.com');
  ok('password reset emails the NEW password to the owner', rp.j.email?.sent && m2.text.includes(rp.j.credentials.password) && /new password/i.test(m2.subject), m2 && m2.subject);

  // SES not configured -> hotel still created, panel told clearly
  const saved = { ...process.env };
  process.env.AWS_SES_HOST = '';
  const B = await call('POST', '/superadmin/tenants', { name: 'Hotel Beta', ownerEmail: 'b@beta.com', password: 'beta1234' }, sa);
  process.env.AWS_SES_HOST = saved.AWS_SES_HOST;
  ok('SES missing: hotel is still created, credentials returned, email.sent=false with reason', B.s === 201 && B.j.email?.sent === false && /not configured/i.test(B.j.email.error) && B.j.adminCredentials.password === 'beta1234', JSON.stringify(B.j.email));
  const bad = await call('POST', '/superadmin/tenants', { name: 'Hotel Gamma', ownerEmail: 'not-an-email' }, sa);
  ok('invalid owner email does not crash', bad.s === 201 && bad.j.email?.sent === false);
  ok('email status endpoint', (await call('GET', '/superadmin/email/status', null, sa)).j.configured === true);

  // ---------- Hotel app: booking events ----------
  const lg = (await call('POST', '/session/login', { username: 'asha@alpha.com', password: 'x' })).s; // (wrong pw after reset)
  ok('old password no longer works', lg === 401);
  const tok = (await call('POST', '/session/login', { username: 'asha@alpha.com', password: rp.j.credentials.password })).j.token;
  const ta = A.j.tenant.tenantId;
  await call('PUT', '/store', { changes: [{ key: 'hotelpms_hotel_info_v3', baseRev: 0, value: JSON.stringify({ name: 'Alpha Inn', phone: '+91 99999 11111', address: '1 Beach Rd', city: 'Goa', currency: 'US Dollar ($)', email: 'frontdesk@alpha.com' }) }] }, tok);
  const booking = { id: 'BK-1001', guest: 'Rahul Sharma', email: 'rahul@guest.com', room: '101', roomType: 'Deluxe King', checkIn: '2026-10-10', checkOut: '2026-10-12', nights: 2, totalAmount: 448, status: 'confirmed', source: 'Walk-in' };
  const e1 = await call('POST', '/notify/event', { event: 'confirmation', booking }, tok);
  ok('confirmation mail sent to the guest', e1.s === 200 && e1.j.guest.status === 'sent' && e1.j.guest.to === 'rahul@guest.com', JSON.stringify(e1.j));
  const g1 = lastTo('rahul@guest.com');
  ok('subject + body use the booking and hotel details', g1 && g1.subject.includes('BK-1001') && g1.subject.includes('Alpha Inn') && g1.text.includes('Rahul Sharma') && g1.text.includes('10 Oct 2026') && g1.text.includes('$448.00') && g1.text.includes('+91 99999 11111'), g1 && g1.subject + ' | ' + g1.text);
  ok('guest mail: From = Hotel name <support@ahaalo.com>, Reply-To = hotel address', g1 && g1.from.value[0].address === 'support@ahaalo.com' && g1.from.value[0].name === 'Alpha Inn' && g1.replyTo?.value[0].address === 'frontdesk@alpha.com', JSON.stringify([g1 && g1.from.value, g1 && g1.replyTo && g1.replyTo.value]));
  ok('guest mail has the Ahaalo logo', g1 && g1.html.includes('cid:ahaalo-logo@ahaalo') && g1.attachments.length >= 1);
  const e1b = await call('POST', '/notify/event', { event: 'confirmation', booking }, tok);
  ok('same booking is never mailed twice', e1b.j.guest.status === 'skipped' && e1b.j.guest.reason === 'already_sent', JSON.stringify(e1b.j.guest));
  const recycled = await call('POST', '/notify/event', { event: 'confirmation', booking: { ...booking, guest: 'New Guest', email: 'newguest@guest.com' } }, tok);
  ok('same booking number but a NEW guest (after a data reset) still gets the mail', recycled.j.guest.status === 'sent' && !!lastTo('newguest@guest.com'), JSON.stringify(recycled.j.guest));
  const n0 = mailbox.length;
  const noMail = await call('POST', '/notify/event', { event: 'confirmation', booking: { ...booking, id: 'BK-1002', email: '' } }, tok);
  ok('no guest email -> quietly skipped, nothing sent', noMail.j.guest.reason === 'no_guest_email' && mailbox.length === n0);
  const ci = await call('POST', '/notify/event', { event: 'checkIn', booking: { ...booking, status: 'checked-in' } }, tok);
  ok('check-in welcome mail', ci.j.guest.status === 'sent' && /Check-in successful/.test(lastTo('rahul@guest.com').subject));
  const co = await call('POST', '/notify/event', { event: 'checkOut', booking }, tok);
  const ca = await call('POST', '/notify/event', { event: 'cancellation', booking }, tok);
  ok('check-out and cancellation mails', co.j.guest.status === 'sent' && ca.j.guest.status === 'sent' && /Cancelled/.test(lastTo('rahul@guest.com').subject));
  const evil = await call('POST', '/notify/event', { event: 'confirmation', booking: { ...booking, id: 'BK-X', guest: '<script>alert(1)</script>', email: 'v@guest.com' } }, tok);
  const gv = lastTo('v@guest.com');
  ok('guest name is HTML-escaped (no script injection)', evil.j.guest.status === 'sent' && !gv.html.includes('<script>alert') && gv.html.includes('&lt;script&gt;'));

  // hotel customised template + disabled template
  await call('PUT', '/store', { changes: [{ key: 'hotelpms_guest_notifications_v1', baseRev: 0, value: JSON.stringify({ confirmation: { enabled: true, subject: 'Hi {GuestName}, room {RoomType} is yours!', body: 'Custom text for {BookingID}' }, checkOut: { enabled: false } }) }] }, tok);
  await call('POST', '/notify/event', { event: 'confirmation', booking: { ...booking, id: 'BK-2000', email: 'c@guest.com' } }, tok);
  const gc = lastTo('c@guest.com');
  ok('hotel\'s own template text is used', gc && gc.subject === 'Hi Rahul Sharma, room Deluxe King is yours!' && gc.text.includes('Custom text for BK-2000'), gc && gc.subject);
  const dis = await call('POST', '/notify/event', { event: 'checkOut', booking: { ...booking, id: 'BK-2001', email: 'd@guest.com' } }, tok);
  ok('disabled template sends nothing', dis.j.guest.reason === 'disabled' && !lastTo('d@guest.com'));

  // staff alerts
  await call('PUT', '/store', { changes: [{ key: 'hotelpms_hotelier_notifications_v1', baseRev: 0, value: JSON.stringify({ staffEmails: 'manager@alpha.com, desk@alpha.com', alertNewDirectBooking: true, alertCancellation: true }) }] }, tok);
  const st = await call('POST', '/notify/event', { event: 'confirmation', booking: { ...booking, id: 'BK-3000', email: 'e@guest.com' } }, tok);
  ok('staff alert for new booking goes to every staff address', st.j.staff?.status === 'sent' && lastTo('manager@alpha.com') && lastTo('desk@alpha.com') && /New booking/.test(lastTo('manager@alpha.com').subject), JSON.stringify(st.j.staff));
  const ns = await call('POST', '/notify/event', { event: 'noShow', booking: { ...booking, id: 'BK-3001' } }, tok);
  ok('alert switched off -> no mail', ns.j.staff?.reason === 'disabled');

  // test email + auth + validation
  const te = await call('POST', '/notify/test', { to: 'owner@mine.com' }, tok);
  ok('send test email', te.s === 200 && /Test email/.test(lastTo('owner@mine.com').subject));
  ok('test email to an invalid address refused', (await call('POST', '/notify/test', { to: 'nope' }, tok)).s === 400);
  ok('notify needs a hotel login', (await call('POST', '/notify/event', { event: 'confirmation', booking }, null)).s === 401);
  ok('unknown event refused', (await call('POST', '/notify/event', { event: 'spam', booking }, tok)).s === 400);
  ok('super admin token is not a hotel login', (await call('POST', '/notify/event', { event: 'confirmation', booking }, sa)).s === 401);

  // wrong custom SMTP -> clear failure, logged, nothing crashes
  await call('PUT', '/store', { changes: [{ key: 'hotelpms_email_config_v1', baseRev: 0, value: JSON.stringify({ sendingMode: 'custom_smtp', smtpHost: '127.0.0.1', smtpPort: '1', security: 'None', fromName: 'X' }) }] }, tok);
  const cf = await call('POST', '/notify/event', { event: 'confirmation', booking: { ...booking, id: 'BK-4000', email: 'f@guest.com' } }, tok);
  ok('broken custom SMTP -> failed with a message, API still 200', cf.s === 200 && cf.j.guest.status === 'failed' && !!cf.j.guest.error, JSON.stringify(cf.j.guest));
  await call('PUT', '/store', { changes: [{ key: 'hotelpms_email_config_v1', baseRev: 1, value: JSON.stringify({ sendingMode: 'builtin' }) }] }, tok);

  // limits
  const EL = mongoose.model('EmailLog'), T = mongoose.model('Tenant');
  const sentToday = await EL.countDocuments({ tenantId: ta, status: 'sent' });
  await T.updateOne({ tenantId: ta }, { $set: { emailDailyLimit: sentToday + 1 } });
  const l1 = await call('POST', '/notify/event', { event: 'confirmation', booking: { ...booking, id: 'BK-5000', email: 'g1@guest.com' } }, tok);
  const l2 = await call('POST', '/notify/event', { event: 'confirmation', booking: { ...booking, id: 'BK-5001', email: 'g2@guest.com' } }, tok);
  ok('daily limit per hotel stops the extra mail', l1.j.guest.status === 'sent' && l2.j.guest.reason === 'daily_limit' && !lastTo('g2@guest.com'), JSON.stringify([l1.j.guest, l2.j.guest]));
  await T.updateOne({ tenantId: ta }, { $set: { emailDailyLimit: 300, emailEnabled: false } });
  ok('super admin can switch email off for a hotel', (await call('POST', '/notify/event', { event: 'confirmation', booking: { ...booking, id: 'BK-5002', email: 'h@guest.com' } }, tok)).j.guest.reason === 'email_disabled');
  await T.updateOne({ tenantId: ta }, { $set: { emailEnabled: true } });
  const sampleLimit = await call('PUT', `/superadmin/tenants/${A.j.tenant._id}`, { emailDailyLimit: 50, emailEnabled: true }, sa);
  ok('super admin can edit the daily limit', sampleLimit.j.emailDailyLimit === 50);
  const ems = await call('GET', `/superadmin/tenants/${A.j.tenant._id}/emails`, null, sa);
  ok('super admin sees the hotel\'s email log', ems.s === 200 && ems.j.total >= 8 && ems.j.failed >= 1 && ems.j.rows[0].to, JSON.stringify(ems.j).slice(0, 200));

  // ---------- website booking + self check-in (guest is not logged in) ----------
  const pub = await call('POST', '/public/bookings', { booking: { ...booking, id: 'WEB-1', email: 'web@guest.com', room: '202', status: 'confirmed', source: 'Direct Web Booking Engine' } }, null, { 'X-Hotel-Id': ta });
  await wait(600);
  ok('website booking saves and mails the guest', pub.s === 201 && !!lastTo('web@guest.com') && lastTo('web@guest.com').text.includes('Custom text for WEB-1'), JSON.stringify([pub.s, pub.j, lastTo('web@guest.com') && lastTo('web@guest.com').text]));
  const sc = await call('POST', '/public/bookings/WEB-1/self-checkin', { guest: 'Web Guest' }, null, { 'X-Hotel-Id': ta });
  await wait(600);
  ok('self check-in mails a welcome message', sc.s === 200 && /Check-in successful/.test(lastTo('web@guest.com').subject), JSON.stringify(sc.j));

  // ---------- pre-arrival reminders ----------
  const inTwo = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  await call('PUT', '/store', { changes: [
    { key: 'hotelpms_guest_notifications_v1', baseRev: 1, value: JSON.stringify({ preArrival: { enabled: true, leadDays: 2 } }) },
    { key: 'hotelpms_bookings_v1', baseRev: 0, value: JSON.stringify([{ id: 'PRE-1', guest: 'Pre Guest', email: 'pre@guest.com', roomType: 'Deluxe', checkIn: inTwo, checkOut: '2099-01-01', status: 'confirmed' }, { id: 'PRE-2', guest: 'Other', email: 'later@guest.com', checkIn: '2099-01-01', checkOut: '2099-01-02', status: 'confirmed' }]) }] }, tok);
  const r1 = await email.runPreArrivalReminders(); const r2 = await email.runPreArrivalReminders();
  ok('pre-arrival reminder goes out once, only for the right date', r1 === 1 && r2 === 0 && !!lastTo('pre@guest.com') && !lastTo('later@guest.com'), JSON.stringify([r1, r2]));

  // ---------- hotels never see each other's mail settings ----------
  const tokB = (await call('POST', '/session/login', { username: 'b@beta.com', password: 'beta1234' })).j.token;
  const bs = await call('POST', '/notify/event', { event: 'confirmation', booking: { ...booking, id: 'BK-B1', email: 'bguest@x.com' } }, tokB);
  const gb = lastTo('bguest@x.com');
  ok('hotel Beta uses its own (default) template, not Alpha\'s custom text', bs.j.guest.status === 'sent' && gb && !gb.text.includes('Custom text') && !gb.html.includes('Alpha Inn'), gb && gb.subject);

  console.log(`\n${pass} passed, ${fail} failed`);
  smtp.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('CRASH', e); process.exit(1); });
