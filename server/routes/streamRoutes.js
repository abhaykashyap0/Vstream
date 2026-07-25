const express = require('express');
const router  = express.Router();
const { exec } = require('child_process');
const Song    = require('../models/Song');

// ── Helper: run yt-dlp and get audio URL ─────────────────────────────
const resolveAudioUrl = (videoId) => {
  return new Promise((resolve, reject) => {
    // Best audio format: m4a preferred, fallback to any audio
    const cmd = [
      'yt-dlp',
      '-f "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio"',
      '--get-url',
      '--no-playlist',
      '--socket-timeout 10',
      `"https://www.youtube.com/watch?v=${videoId}"`
    ].join(' ');

    console.log(`[yt-dlp] Resolving: ${videoId}`);

    exec(cmd, { timeout: 20000 }, (err, stdout, stderr) => {
      if (err) {
        console.error(`[yt-dlp] Failed for ${videoId}:`, stderr?.slice(0, 200));
        return reject(new Error(stderr || 'yt-dlp failed'));
      }
      const url = stdout.trim().split('\n')[0];
      if (!url || !url.startsWith('http')) {
        return reject(new Error('No valid URL returned'));
      }
      console.log(`[yt-dlp] ✅ Resolved ${videoId}`);
      resolve(url);
    });
  });
};

// ── GET /api/stream/audio-url/:videoId ───────────────────────────────
// Returns a direct streamable audio URL for any YouTube video ID.
// Caches in MongoDB so same video never hits yt-dlp twice.
router.get('/audio-url/:videoId', async (req, res) => {
  const { videoId } = req.params;

  // Validate video ID format
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'Invalid YouTube video ID' });
  }

  try {
    // ── Step 1: Check MongoDB cache ───────────────────────────────
    const cached = await Song.findOne({ youtube_id: videoId });
    if (cached?.resolved_audio_url && cached?.audio_url_expires_at > Date.now()) {
      console.log(`[Stream] Cache hit for ${videoId}`);
      return res.json({
        url:      cached.resolved_audio_url,
        videoId,
        source:   'cache',
        title:    cached.title,
        artist:   cached.artist,
        image:    cached.image_url
      });
    }

    // ── Step 2: Resolve via yt-dlp ────────────────────────────────
    const audioUrl = await resolveAudioUrl(videoId);

    // ── Step 3: Cache in MongoDB (URLs expire in 5 hours) ─────────
    // YouTube signed URLs expire ~6 hours so we cache for 5 to be safe
    const expiresAt = Date.now() + (5 * 60 * 60 * 1000);

    Song.findOneAndUpdate(
      { youtube_id: videoId },
      {
        $set: {
          resolved_audio_url:  audioUrl,
          audio_url_expires_at: expiresAt
        }
      },
      { upsert: false } // only update if song already exists
    ).catch(() => {}); // fire and forget

    return res.json({
      url:     audioUrl,
      videoId,
      source:  'yt-dlp',
      expires: expiresAt
    });

  } catch (err) {
    console.error(`[Stream] Error for ${videoId}:`, err.message);
    return res.status(500).json({
      error:   'Could not resolve audio stream',
      detail:  err.message,
      videoId
    });
  }
});

// ── GET /api/stream/health ────────────────────────────────────────────
// Check if yt-dlp is installed and working
router.get('/health', (req, res) => {
  exec('yt-dlp --version', (err, stdout) => {
    if (err) {
      return res.status(500).json({ ok: false, error: 'yt-dlp not installed' });
    }
    res.json({ ok: true, version: stdout.trim() });
  });
});

module.exports = router;