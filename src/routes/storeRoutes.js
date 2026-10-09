const express = require('express');
const { requireTenant } = require('../middleware/tenantAuth');
const store = require('../services/storeService');
const Tenant = require('../models/Tenant');

const router = express.Router();
router.use(requireTenant);

// Full snapshot (used once at app start)
router.get('/', async (req, res, next) => {
  try {
    const { entries, empty } = await store.getAll(req.tenantId);
    res.json({ success: true, empty, isDefaultTenant: !!req.tenant.isDefault, entries });
  } catch (err) {
    next(err);
  }
});

// Cheap "what changed" poll: list of key + revision
router.get('/manifest', async (req, res, next) => {
  try {
    res.json({ success: true, entries: await store.getManifest(req.tenantId) });
  } catch (err) {
    next(err);
  }
});

router.post('/get', async (req, res, next) => {
  try {
    res.json({ success: true, entries: await store.getKeys(req.tenantId, req.body.keys) });
  } catch (err) {
    next(err);
  }
});

// Batched write-through: { changes: [{ key, value|null, baseRev }] }
router.put('/', async (req, res, next) => {
  try {
    const results = await store.applyChanges(req.tenantId, req.body.changes);
    res.json({ success: true, results });
  } catch (err) {
    next(err);
  }
});

// "Reset all data" button
router.post('/reset', async (req, res, next) => {
  try {
    await store.resetTenant(req.tenantId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get('/tenant', async (req, res) => {
  const t = await Tenant.findOne({ tenantId: req.tenantId }).lean();
  res.json({ success: true, tenant: { tenantId: t.tenantId, name: t.name, currency: t.currency, plan: t.plan, maxRooms: t.maxRooms } });
});

module.exports = router;
