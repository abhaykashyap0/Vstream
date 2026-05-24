const express  = require('express');
const router   = express.Router();
const { protect } = require('../middleware/authMiddleware');
const User     = require('../models/User');

// ── Get profile ────────────────────────────────────────────────────
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Update username ────────────────────────────────────────────────
router.put('/update-username', protect, async (req, res) => {
  const { username } = req.body;
  try {
    if (!username?.trim())
      return res.status(400).json({ message: 'Username cannot be empty' });

    if (username.trim().length < 3)
      return res.status(400).json({ message: 'Username must be at least 3 characters' });

    if (username.trim().length > 20)
      return res.status(400).json({ message: 'Username must be under 20 characters' });

    // Check if taken by another user
    const existing = await User.findOne({
      username: username.trim(),
      _id: { $ne: req.user._id }
    });
    if (existing) return res.status(400).json({ message: 'Username already taken' });

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { username: username.trim() },
      { new: true }
    ).select('-password');

    res.json({ message: 'Username updated!', user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;