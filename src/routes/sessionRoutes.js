const express = require('express');
const bcrypt = require('bcryptjs');
const Account = require('../models/Account');
const Tenant = require('../models/Tenant');
const StoreEntry = require('../models/StoreEntry');
const { USERS_KEY } = require('../config/storeKeys');
const { signStaffToken, requireTenant, rateLimit } = require('../middleware/tenantAuth');
const { norm } = require('../services/accountService');

const router = express.Router();

// POST /api/session/login  { username, password, hotel }
router.post('/login', rateLimit({ max: 20 }), async (req, res, next) => {
  try {
    const rawUser = String(req.body.username || '').trim().toLowerCase();
    const username = norm(rawUser);
    const password = String(req.body.password || '').trim();
    const hotelInput = String(req.body.hotel || '').trim();

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }
    if (!hotelInput) {
      return res.status(400).json({ success: false, message: '4-Digit Hotel Code / ID is required.' });
    }

    // 1. Strictly match tenant by 4-digit hotelCode or tenantId
    const tenant = await Tenant.findOne({
      $or: [
        { hotelCode: hotelInput },
        { tenantId: hotelInput.toLowerCase() }
      ]
    }).lean();

    if (!tenant) {
      return res.status(401).json({ success: false, message: 'Invalid Hotel Code / ID. Please check your 4-digit Hotel Code.' });
    }

    if (tenant.status === 'suspended' || tenant.status === 'canceled') {
      return res.status(403).json({ success: false, message: 'This hotel account is not active. Contact support.' });
    }

    // 2. Query accounts for THIS specific tenant only
    const userQuery = {
      tenantId: tenant.tenantId,
      $or: [{ username }, { email: username }]
    };
    if (rawUser.includes('@')) userQuery.$or.push({ email: norm(rawUser) });

    const candidates = await Account.find(userQuery);

    const checkPassword = async (accountList) => {
      for (const c of accountList) {
        if (c.passwordHash && (await bcrypt.compare(password, c.passwordHash))) {
          return c;
        }
        try {
          const storeDoc = await StoreEntry.findOne({ tenantId: c.tenantId, key: USERS_KEY }).lean();
          const userList = JSON.parse(storeDoc?.value || '[]');
          if (Array.isArray(userList)) {
            const storeUser = userList.find((u) => u && (norm(u.username) === norm(c.username) || norm(u.email) === norm(c.email)));
            if (storeUser && storeUser.password && String(storeUser.password).trim() === password) {
              const newHash = await bcrypt.hash(password, 10);
              await Account.updateOne({ _id: c._id }, { $set: { passwordHash: newHash } });
              return c;
            }
          }
        } catch {
          /* ignore */
        }
      }
      return null;
    };

    const matched = await checkPassword(candidates);

    if (!matched) {
      return res.status(401).json({ success: false, message: 'Invalid username or password for this Hotel Code.' });
    }

    if (matched.status === 'Suspended') {
      return res.status(403).json({ success: false, message: 'Account is suspended. Please contact your system administrator.' });
    }

    await Account.updateOne({ _id: matched._id }, { $set: { lastLoginAt: new Date() } });
    const token = signStaffToken({ tenantId: matched.tenantId, accountId: matched._id, username: matched.username });
    res.json({
      success: true,
      token,
      tenantId: matched.tenantId,
      isDefaultTenant: !!tenant.isDefault,
      user: { username: matched.username, name: matched.name, role: matched.role, email: matched.email },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireTenant, (req, res) => {
  res.json({ success: true, tenantId: req.tenantId, username: req.auth.un, isDefaultTenant: !!req.tenant.isDefault });
});

module.exports = router;
