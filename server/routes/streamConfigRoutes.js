// server/routes/streamConfigRoutes.js
// Stores the stream server's CURRENT public URL (it changes every time the free
// Cloudflare quick tunnel restarts). The stream server registers its URL here on
// startup; the website asks here for the address before playing songs.
const express  = require('express');
const mongoose = require('mongoose');

const router = express.Router();

const StreamConfig = mongoose.models.StreamConfig || mongoose.model(
  'StreamConfig',
  new mongoose.Schema({
    key:       { type: String, default: 'main', unique: true },
    url:       { type: String, default: '' },
    updatedAt: { type: Date,   default: Date.now }
  })
);

// GET /api/stream-config → { ok, url, updatedAt }   (public — the site needs it)
router.get('/', async (req, res) => {
  try {
    const doc = await StreamConfig.findOne({ key: 'main' }).lean();
    if (!doc?.url) return res.status(404).json({ ok: false, message: 'Stream server has not registered yet' });
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, url: doc.url, updatedAt: doc.updatedAt });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// POST /api/stream-config { url }  — only the stream server may call this.
// Header: x-register-key must equal the STREAM_REGISTER_KEY env var on Render.
router.post('/', async (req, res) => {
  const secret = process.env.STREAM_REGISTER_KEY;
  if (!secret) return res.status(503).json({ ok: false, message: 'STREAM_REGISTER_KEY is not set on the server' });
  if (req.get('x-register-key') !== secret) return res.status(401).json({ ok: false, message: 'Bad register key' });

  let parsed;
  try { parsed = new URL(String(req.body?.url || '')); } catch { parsed = null; }
  if (!parsed || parsed.protocol !== 'https:') {
    return res.status(400).json({ ok: false, message: 'url must be a valid https URL' });
  }

  const url = parsed.origin; // strips any path/query
  await StreamConfig.findOneAndUpdate(
    { key: 'main' },
    { url, updatedAt: new Date() },
    { upsert: true, new: true }
  );
  console.log(`[StreamConfig] Stream server registered: ${url}`);
  res.json({ ok: true, url });
});

module.exports = router;