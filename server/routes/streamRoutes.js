const express = require('express');
const router  = express.Router();
const { exec } = require('child_process');
const Song    = require('../models/Song');

// ── Helper: find Node.js binary path ─────────────────────────────────
const getNodePath = () => {
  return process.execPath; // absolute path to node binary on this system
};

// ── Helper: run yt-dlp and get audio URL ─────────────────────────────
const resolveAudioUrl = (videoId) => {
  return new Promise((resolve, reject) => {
    const nodePath = getNodePath();

    const cmd = [
      'yt-dlp',
      '-f "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio"',
      '--get-url',
      '--no-playlist',
      '--socket-timeout 10',
      `--js-runtimes "node:${nodePath}"`,
      '--extractor-args "youtube:player_client=web"',
      '--no-check-certificates',
      `"https://www.youtube.com/watch?v=${videoId}"`
    ].join(' ');

    console.log(`[yt-dlp] Resolving: ${videoId}`);
    console.log(`[yt-dlp] Node path: ${nodePath}`);

    exec(cmd, { timeout: 25000 }, (err, stdout, stderr) => {
      if (err) {
        // Log full error for debugging
        console.error(`[yt-dlp] Failed for ${videoId}`);
        console.error(`[yt-dlp] stderr: ${stderr?.slice(0, 500)}`);
        return reject(new Error(stderr?.slice(0, 300) || 'yt-dlp failed'));
      }

      const url = stdout.trim().split('\n')[0];
      if (!url || !url.startsWith('http')) {
        console.error(`[yt-dlp] No valid URL in output: ${stdout?.slice(0, 200)}`);
        return reject(new Error('No valid audio URL returned by yt-dlp'));
      }

      console.log(`[yt-dlp] ✅ Resolved ${videoId} → ${url.slice(0, 80)}...`);
      resolve(url);
    });
  });
};

// ── GET /api/stream/health ────────────────────────────────────────────
// Check yt-dlp version + node path — test this first after deploy
router.get('/health', (req, res) => {
  const nodePath = getNodePath();
  exec('yt-dlp --version', (err, stdout) => {
    if (err) {
      return res.status(500).json({
        ok:    false,
        error: 'yt-dlp not installed or not in PATH',
        node:  nodePath
      });
    }
    res.json({
      ok:      true,
      ytdlp:   stdout.trim(),
      node:    nodePath,
      message: 'yt-dlp ready ✅'
    });
  });
});

// ── GET /api/stream/test ──────────────────────────────────────────────
// Quick end-to-end test with YouTube's first video (always available)
router.get('/test', async (req, res) => {
  try {
    const url = await resolveAudioUrl('jNQXAC9IVRw'); // "Me at the zoo"
    res.json({ ok: true, test_url: url, message: 'yt-dlp working ✅' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/stream/audio-url/:videoId ───────────────────────────────
// Main endpoint — returns direct streamable audio URL for any YouTube ID
// Caches result in MongoDB so same video never hits yt-dlp twice
router.get('/audio-url/:videoId', async (req, res) => {
  const { videoId } = req.params;

  // Validate YouTube video ID format (always 11 chars)
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'Invalid YouTube video ID format' });
  }

  try {
    // ── Step 1: Check MongoDB cache ───────────────────────────────
    // YouTube signed URLs expire ~6hrs so we cache for 5hrs
    const cached = await Song.findOne({ youtube_id: videoId });
    if (
      cached?.resolved_audio_url &&
      cached?.audio_url_expires_at &&
      cached.audio_url_expires_at > Date.now()
    ) {
      const expiresInMins = Math.round((cached.audio_url_expires_at - Date.now()) / 60000);
      console.log(`[Stream] Cache hit for ${videoId} (expires in ${expiresInMins}min)`);
      return res.json({
        url:      cached.resolved_audio_url,
        videoId,
        source:   'cache',
        title:    cached.title   || null,
        artist:   cached.artist  || null,
        image:    cached.image_url || null,
        expires:  cached.audio_url_expires_at
      });
    }

    // ── Step 2: Resolve via yt-dlp ────────────────────────────────
    const audioUrl  = await resolveAudioUrl(videoId);
    const expiresAt = Date.now() + (5 * 60 * 60 * 1000); // 5 hours from now

    // ── Step 3: Cache in MongoDB (background, non-blocking) ───────
    Song.findOneAndUpdate(
      { youtube_id: videoId },
      {
        $set: {
          resolved_audio_url:   audioUrl,
          audio_url_expires_at: expiresAt
        }
      },
      { upsert: false } // only cache if song doc already exists
    ).catch(err => console.warn(`[Stream] Cache write skipped: ${err.message}`));

    return res.json({
      url:     audioUrl,
      videoId,
      source:  'yt-dlp',
      expires: expiresAt
    });

  } catch (err) {
    console.error(`[Stream] Final error for ${videoId}:`, err.message);
    return res.status(500).json({
      error:   'Could not resolve audio stream',
      detail:  err.message,
      videoId,
      hint:    'Video may be region-locked, age-restricted, or unavailable'
    });
  }
});

module.exports = router;