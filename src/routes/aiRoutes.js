const express = require('express');
const { requireTenant } = require('../middleware/tenantAuth');

const router = express.Router();
router.use(requireTenant);

const SYSTEM_PROMPT = `You are "InnOut AI Help", the built-in assistant of a hotel Property Management System (PMS).
You are given a JSON snapshot of the hotel's current data (rooms, room types, bookings, summary numbers) and a staff member's question.
Rules:
- Answer ONLY from the snapshot and general hotel-operations knowledge. If the snapshot does not contain the answer, say so plainly - never invent guests, rooms, amounts or dates.
- You cannot change data. Never claim you booked, cancelled, checked in/out, charged or moved anything. If the user wants an action, tell them the exact command wording the assistant understands, e.g. "Check in Amit Kulkarni", "Cancel booking for Room 102", "Block Room 302 for AC repair", "Mark Room 201 as Clean".
- Be concise and practical (front-desk tone). Use **bold** for key figures and "•" bullets for lists. Reply in the same language the user wrote in (English / Hindi / Hinglish).`;

// POST /api/ai/chat  { message, context, history? }
router.post('/chat', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ success: false, configured: false, message: 'AI is not configured on the server (ANTHROPIC_API_KEY missing).' });
  }
  const message = String(req.body.message || '').trim().slice(0, 2000);
  if (!message) return res.status(400).json({ success: false, message: 'message is required' });

  let context = '';
  try {
    context = JSON.stringify(req.body.context || {});
  } catch {
    context = '{}';
  }
  if (context.length > 120_000) context = context.slice(0, 120_000);

  const history = Array.isArray(req.body.history)
    ? req.body.history
        .slice(-6)
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map((m) => ({ role: m.role, content: m.content.slice(0, 1500) }))
    : [];

  // Anthropic requires the first message to be from the user and roles to alternate
  const cleaned = [];
  for (const m of history) {
    if (cleaned.length === 0 && m.role !== 'user') continue;
    if (cleaned.length && cleaned[cleaned.length - 1].role === m.role) continue;
    cleaned.push(m);
  }
  if (cleaned.length && cleaned[cleaned.length - 1].role === 'user') cleaned.pop();

  const messages = [...cleaned, { role: 'user', content: `HOTEL SNAPSHOT (JSON):\n${context}\n\nQUESTION:\n${message}` }];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
        max_tokens: 700,
        system: SYSTEM_PROMPT,
        messages,
      }),
      signal: controller.signal,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('Anthropic API error:', r.status, data?.error?.message || data);
      return res.status(502).json({ success: false, message: 'AI service error. Please try again.' });
    }
    const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    res.json({ success: true, text });
  } catch (err) {
    console.error('Anthropic request failed:', err.message);
    res.status(504).json({ success: false, message: 'AI service timed out. Please try again.' });
  } finally {
    clearTimeout(timer);
  }
});

router.get('/status', (req, res) => {
  res.json({ success: true, claude: !!process.env.ANTHROPIC_API_KEY, googleVision: !!process.env.GOOGLE_VISION_API_KEY });
});

module.exports = router;
