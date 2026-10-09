// Checks the AWS SES login WITHOUT sending any mail:   npm run check:email
// Optional: send a real test mail:                       npm run check:email -- you@example.com
require('dotenv').config();
const email = require('../src/services/emailService');

(async () => {
  const e = process.env;
  const need = ['AWS_SES_HOST', 'AWS_SES_USER', 'AWS_SES_PASS', 'AWS_SES_FROM_EMAIL'].filter((k) => !e[k]);
  if (need.length) { console.log(`❌ Missing in backend/.env: ${need.join(', ')}`); process.exit(1); }
  const pass = e.AWS_SES_PASS;
  console.log(`Host: ${e.AWS_SES_HOST}:${e.AWS_SES_PORT || 587}   User: ${e.AWS_SES_USER.slice(0, 4)}…${e.AWS_SES_USER.slice(-4)}   From: ${e.AWS_SES_FROM_EMAIL}`);
  const odd = [...pass].filter((c) => !/[A-Za-z0-9+/=]/.test(c));
  if (odd.length || pass.length !== 44) {
    console.log(`⚠️  The password does not look like an SES SMTP password: length ${pass.length} (should be 44)${odd.length ? `, contains ${JSON.stringify(odd[0])} (only A-Z a-z 0-9 + / = are possible)` : ''}.`);
    console.log('   It was probably typed / copied wrongly. In the SES console create new SMTP credentials and COPY-PASTE them (never retype).');
  }
  const r = await email.verifyPlatform();
  console.log(r.ok ? '✅ AWS SES accepted the login. Emails can be sent.' : `❌ AWS SES rejected it: ${r.error}`);
  const to = process.argv[2];
  if (r.ok && to) {
    const s = await email.sendCredentialsEmail({ to, hotelName: 'Test Hotel', ownerName: 'Test', username: 'admin', email: to, password: '(test only)', loginUrl: `${e.HOTEL_APP_URL || 'http://localhost:5173'}/login` });
    console.log(s.ok ? `✅ Test mail sent to ${to}` : `❌ Could not send: ${s.error}`);
  }
  process.exit(r.ok ? 0 : 1);
})();
