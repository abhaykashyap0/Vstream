const express  = require('express');
const router   = express.Router();
const User     = require('../models/User');
const UserSession = require('../models/UserSession');

// ── Admin secret check middleware ──────────────────────────────────────────
// Only you know this key. Set ADMIN_SECRET in your .env file.
const adminAuth = (req, res, next) => {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (!key || key !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ message: 'Access denied' });
  }
  next();
};

// ── POST /api/admin/session/start ──────────────────────────────────────────
// Called from frontend when a user logs in (record session start)
router.post('/session/start', async (req, res) => {
  try {
    const { userId, username, email, ipAddress, userAgent } = req.body;
    const session = await UserSession.create({ userId, username, email, ipAddress, userAgent });
    res.json({ sessionId: session._id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/admin/session/song ───────────────────────────────────────────
// Called from frontend when a user plays a song
router.post('/session/song', async (req, res) => {
  try {
    const { sessionId, songId, title, artist } = req.body;
    if (!sessionId) return res.json({ ok: true }); // graceful no-op
    await UserSession.findByIdAndUpdate(sessionId, {
      $push: { songsPlayed: { songId, title, artist, playedAt: new Date() } }
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/admin/session/end ────────────────────────────────────────────
// Called from frontend on logout
router.post('/session/end', async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.json({ ok: true });
    const session = await UserSession.findById(sessionId);
    if (!session) return res.json({ ok: true });
    const logoutAt   = new Date();
    const durationMs = logoutAt - session.loginAt;
    await UserSession.findByIdAndUpdate(sessionId, { logoutAt, durationMs });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/admin/dashboard ───────────────────────────────────────────────
// Admin-only: get all user activity
router.get('/dashboard', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 50, userId } = req.query;
    const filter = userId ? { userId } : {};

    const sessions = await UserSession.find(filter)
      .sort({ loginAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .populate('userId', 'username email createdAt');

    const totalUsers  = await User.countDocuments();
    const totalSessions = await UserSession.countDocuments();

    // Active right now (no logoutAt)
    const activeSessions = await UserSession.find({ logoutAt: null })
      .populate('userId', 'username email');

    // Most played songs across all sessions
    const topSongs = await UserSession.aggregate([
      { $unwind: '$songsPlayed' },
      { $group: { _id: '$songsPlayed.title', artist: { $first: '$songsPlayed.artist' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    // Per-user stats
    const userStats = await UserSession.aggregate([
      { $group: {
        _id: '$userId',
        username:      { $first: '$username' },
        email:         { $first: '$email' },
        totalSessions: { $sum: 1 },
        totalDurationMs: { $sum: '$durationMs' },
        totalSongsPlayed: { $sum: { $size: '$songsPlayed' } },
        lastLogin: { $max: '$loginAt' }
      }},
      { $sort: { lastLogin: -1 } }
    ]);

    res.json({
      summary: { totalUsers, totalSessions, activeNow: activeSessions.length },
      activeSessions,
      sessions,
      userStats,
      topSongs
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/admin/user/:userId ────────────────────────────────────────────
// Admin-only: get all sessions for a specific user
router.get('/user/:userId', adminAuth, async (req, res) => {
  try {
    const sessions = await UserSession.find({ userId: req.params.userId }).sort({ loginAt: -1 });
    const user     = await User.findById(req.params.userId).select('-password');
    res.json({ user, sessions });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;