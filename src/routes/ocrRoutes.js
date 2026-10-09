const express = require('express');
const { requireTenant } = require('../middleware/tenantAuth');

const router = express.Router();
router.use(requireTenant);

// POST /api/ocr/google-vision  { imageBase64 }  -> raw Google Vision response (text + face detection)
// The Google API key stays on the server instead of being shipped inside the website's JavaScript.
router.post('/google-vision', async (req, res) => {
  const key = process.env.GOOGLE_VISION_API_KEY;
  if (!key) return res.status(503).json({ success: false, configured: false, message: 'GOOGLE_VISION_API_KEY is not set on the server.' });

  const imageBase64 = String(req.body.imageBase64 || '');
  if (!imageBase64 || imageBase64.length > 14_000_000) {
    return res.status(400).json({ success: false, message: 'imageBase64 missing or too large' });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const r = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requests: [{ image: { content: imageBase64 }, features: [{ type: 'TEXT_DETECTION' }, { type: 'FACE_DETECTION' }] }],
      }),
      signal: controller.signal,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('Google Vision error:', r.status, data?.error?.message || '');
      return res.status(502).json({ success: false, message: 'Google Vision request failed' });
    }
    res.json(data);
  } catch (err) {
    res.status(504).json({ success: false, message: 'Google Vision timed out' });
  } finally {
    clearTimeout(timer);
  }
});

module.exports = router;
