const express = require('express');
const router = express.Router();
const MiscTransaction = require('../models/MiscTransaction');
const { requireTenant } = require('../middleware/tenantAuth');

router.use(requireTenant);

// GET /api/misc-transactions - Fetch transactions for current tenant
router.get('/', async (req, res) => {
  try {
    const tenantId = req.tenantId || 'default';
    const { date, type, category } = req.query;

    const filter = { tenantId, isDeleted: false };
    if (date) filter.date = date;
    if (type) filter.type = type.toUpperCase();
    if (category) filter.category = category;

    const txs = await MiscTransaction.find(filter).sort({ createdAt: -1 }).lean();
    return res.json({ success: true, count: txs.length, data: txs });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/misc-transactions - Save or update transaction
router.post('/', async (req, res) => {
  try {
    const tenantId = req.tenantId || 'default';
    const body = req.body || {};

    const seqId = String(body.seqId || body.id || `MSC-${Date.now()}`).trim();
    const doc = await MiscTransaction.findOneAndUpdate(
      { tenantId, seqId },
      {
        $set: {
          tenantId,
          seqId,
          id: String(body.id || seqId).trim(),
          date: body.date || new Date().toISOString().slice(0, 10),
          time: body.time || '',
          type: String(body.type || 'SALE').toUpperCase().trim(),
          category: body.category || 'Misc / Other',
          itemName: body.itemName || body.item || 'Misc Item',
          amountUSD: Number(body.amountUSD || body.amount || 0),
          settlement: body.settlement || body.mode || 'Cash',
          roomNumber: body.roomNumber || body.roomNo || 'N/A',
          guestName: body.guestName || body.guest || 'N/A',
          bookingId: body.bookingId || null,
          recordedBy: body.recordedBy || 'System',
          notes: body.notes || body.note || '',
          isDeleted: Boolean(body.isDeleted)
        }
      },
      { upsert: true, new: true }
    );

    return res.json({ success: true, data: doc });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// DELETE /api/misc-transactions/:id - Delete transaction
router.delete('/:id', async (req, res) => {
  try {
    const tenantId = req.tenantId || 'default';
    const { id } = req.params;

    const result = await MiscTransaction.findOneAndUpdate(
      { tenantId, $or: [{ seqId: id }, { id }] },
      { $set: { isDeleted: true } },
      { new: true }
    );

    return res.json({ success: true, deleted: Boolean(result), data: result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
