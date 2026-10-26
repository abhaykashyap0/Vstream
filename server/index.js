const express  = require('express');
const cors     = require('cors');
const axios    = require('axios'); // npm install axios — needed for the /play proxy route below
const { exec, spawn } = require('child_process');

const app  = express();
const PORT = 3000;

// ── Public URL registration (free Cloudflare quick tunnel) ────────────
// The quick tunnel gets a NEW random address every start. This server starts the
// tunnel itself, reads the address, and tells the backend, so the website always
// asks the backend for the current address (nothing to redeploy).
const BACKEND_URL      = (process.env.VSTREAM_BACKEND || 'https://vstream-jrad.onrender.com').replace(/\/$/, '');
const REGISTER_KEY     = process.env.STREAM_REGISTER_KEY || '';
const CLOUDFLARED_PATH = process.env.CLOUDFLARED_PATH || 'cloudflared';
let   currentTunnelUrl = null;

// ── CORS + ngrok headers ──────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, ngrok-skip-browser-warning, Accept, Range');
  res.setHeader('ngrok-skip-browser-warning',   'true');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(cors({ origin: '*' }));
app.use(express.json());

// ── Node.js path ──────────────────────────────────────────────────────
const NODE_PATH = process.execPath;

// ══════════════════════════════════════════════════════════════════════
// MEMORY CACHE
// YouTube signed URLs expire in 6hrs — we cache for 5hrs
// Cache clears on server restart (fine, URLs would be expired anyway)
// ══════════════════════════════════════════════════════════════════════
const memCache = new Map(); // videoId → { url, headers, expiresAt, title, cachedAt }

const getCached = (videoId) => {
  const entry = memCache.get(videoId);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    memCache.delete(videoId);
    console.log(`[Cache] Expired and removed: ${videoId}`);
    return null;
  }
  return entry;
};

const setCache = (videoId, url, title = '', headers = {}, client = '') => {
  const expiresAt = Date.now() + (5 * 60 * 60 * 1000); // 5 hours
  memCache.set(videoId, { url, headers, client, expiresAt, title, cachedAt: Date.now() });
  console.log(`[Cache] Stored: ${videoId} "${title}" (expires in 5hrs, cache size: ${memCache.size})`);
};

// Clean expired entries every 30 minutes
setInterval(() => {
  const now     = Date.now();
  let   removed = 0;
  for (const [id, entry] of memCache.entries()) {
    if (entry.expiresAt < now) { memCache.delete(id); removed++; }
  }
  if (removed > 0) console.log(`[Cache] Cleaned ${removed} expired entries (${memCache.size} remaining)`);
}, 30 * 60 * 1000);

// ══════════════════════════════════════════════════════════════════════
// YT-DLP RESOLVER
// Tries player clients in order. 'mweb' returns real audio-only formats
// (with the bgutil PO token + Deno); 'web' is the fallback and often only
// offers muxed format 18. yt-dlp prints the URL AND the exact HTTP headers
// it expects (User-Agent etc.) — /play must reuse those headers, otherwise
// googlevideo answers 403.
// ══════════════════════════════════════════════════════════════════════
const PLAYER_CLIENTS = ['mweb', 'web'];

const runYtDlp = (videoId, client) => new Promise((resolve, reject) => {
  const cmd = [
    'yt-dlp',
    '-f "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/18/best"',
    '--print url',
    '--print "%(http_headers)j"',
    '--no-playlist',
    '--socket-timeout 10',
    `--extractor-args "youtube:player_client=${client}"`,
    '--remote-components ejs:github',
    `"https://www.youtube.com/watch?v=${videoId}"`
  ].join(' ');

  exec(cmd, { timeout: 75000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
    const lines = stdout.trim().split('\n').filter(Boolean);
    const url   = lines[0];
    if (err || !url || !url.startsWith('http')) {
      const tail   = (stderr || '').trim().split('\n').slice(-3).join(' | ');
      const errLn  = (stderr || '').split('\n').filter(l => /ERROR/.test(l)).pop();
      const reason = err?.killed
        ? `yt-dlp timed out (killed after 75s, signal ${err.signal}). stderr tail: ${tail}`
        : (errLn || tail || `exit code ${err?.code}, no output`);
      return reject(new Error(reason.trim()));
    }
    let headers = {};
    try { headers = JSON.parse(lines[1] || '{}'); } catch {}
    resolve({ url, headers });
  });
});

const inflight = new Map(); // videoId → { promise, promoted } (dedupes prefetch + audio-url + play)

// Two yt-dlp runs at once each take ~2x as long (CPU, Deno start-up, PO token), so a
// song the user is waiting for must not share the machine with background work.
// "low" priority = preparing the NEXT song: it waits until no "high" resolve is running.
let activeHigh = 0;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const resolveEntry = (videoId, title = '', clients = PLAYER_CLIENTS, priority = 'high') => {
  const cached = getCached(videoId);
  if (cached) {
    const remainingMins = Math.round((cached.expiresAt - Date.now()) / 60000);
    console.log(`[Cache] ✅ Hit for "${cached.title || videoId}" (${remainingMins}min remaining)`);
    return Promise.resolve(cached);
  }
  if (inflight.has(videoId)) {
    const existing = inflight.get(videoId);
    if (priority === 'high') existing.promoted = true; // someone is now waiting on a background resolve
    return existing.promise;
  }

  const meta = { promoted: priority === 'high', promise: null };

  const promise = (async () => {
    if (!meta.promoted) {
      while (activeHigh > 0 && !meta.promoted) await sleep(250); // let the urgent song finish first
    }
    const counted = meta.promoted;
    if (counted) activeHigh++;
    try {
      console.log(`[yt-dlp] Resolving${priority === 'low' && !meta.promoted ? ' (next song)' : ''}: ${videoId} "${title}"`);
      const start = Date.now();
      let lastErr;
      for (const client of clients) {
        try {
          const { url, headers } = await runYtDlp(videoId, client);
          console.log(`[yt-dlp] ✅ Resolved via ${client} in ${Date.now() - start}ms: ${videoId}`);
          const itag = (url.match(/[?&]itag=(\d+)/) || [])[1];
          console.log(`[yt-dlp]    client=${client} itag=${itag}`);
          setCache(videoId, url, title, headers, client);
          return getCached(videoId);
        } catch (e) {
          lastErr = e;
          console.error(`[yt-dlp] ❌ ${client} failed for ${videoId}: ${e.message.slice(0, 400)}`);
        }
      }
      throw lastErr;
    } finally {
      if (counted) activeHigh--;
    }
  })().finally(() => inflight.delete(videoId));

  meta.promise = promise;
  inflight.set(videoId, meta);
  return promise;
};

const resolveAudioUrl = async (videoId, title = '') => (await resolveEntry(videoId, title)).url;

// Builds an absolute URL to our own /play/:videoId route, using whatever
// host the request actually came in on. Scheme is hardcoded to https —
// ngrok always serves this publicly over HTTPS but forwards to this
// server internally over plain HTTP, so req.protocol reports 'http' even
// though the real public URL is https. Handing the browser an http://
// URL on an HTTPS page (vstream-black.vercel.app) triggers a mixed-content
// block/auto-upgrade that fails for <audio> element playback — this was
// the actual cause of every song failing to load and auto-skipping.
const buildPlayUrl = (req, videoId) => `${currentTunnelUrl || `https://${req.get('host')}`}/play/${videoId}`;

// ══════════════════════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════════════════════

// ── GET /health ───────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  exec('yt-dlp --version', (err, ytVersion) => {
    res.json({
      ok:        true,
      ytdlp:     ytVersion?.trim() || 'not found',
      node:      process.version,
      nodePath:  NODE_PATH,
      cached:    memCache.size,
      cacheKeys: [...memCache.keys()].slice(0, 5), // show first 5 cached IDs
      status:    'VStream Stream Server ✅'
    });
  });
});

// ── GET /test ─────────────────────────────────────────────────────────
app.get('/test', async (req, res) => {
  try {
    const start = Date.now();
    const url   = await resolveAudioUrl('dQw4w9WgXcQ', 'Never Gonna Give You Up');
    res.json({
      ok:      true,
      message: `yt-dlp working ✅ (${Date.now() - start}ms)`,
      fullUrl: url,
      cached:  memCache.size
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /cache-stats ──────────────────────────────────────────────────
app.get('/cache-stats', (req, res) => {
  const now     = Date.now();
  const entries = [...memCache.entries()].map(([id, e]) => ({
    videoId:      id,
    title:        e.title,
    expiresIn:    `${Math.round((e.expiresAt - now) / 60000)}min`,
    cachedAgo:    `${Math.round((now - e.cachedAt) / 60000)}min ago`
  }));
  res.json({ total: memCache.size, entries });
});

// ── GET /prefetch/:videoId ────────────────────────────────────────────
// Called by PlayerBar to pre-resolve next song while current plays
// Returns 200 immediately even if already resolving (fire and forget)
app.get('/prefetch/:videoId', (req, res) => {
  const { videoId } = req.params;
  const title       = req.query.title || '';

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'Invalid video ID' });
  }

  // If already cached — nothing to do
  if (getCached(videoId)) {
    return res.json({ ok: true, status: 'already_cached' });
  }

  // Fire and forget — don't await
  resolveEntry(videoId, title, PLAYER_CLIENTS, 'low').catch(() => {});
  res.json({ ok: true, status: 'prefetching' });
});

// ── GET /audio-url/:videoId ───────────────────────────────────────────
// Main endpoint — resolves YouTube video ID, but returns OUR OWN /play
// proxy URL, not the raw googlevideo URL. The raw URL is IP-locked to
// whichever server resolved it — handing it straight to the browser (a
// different IP) caused every song to fail with "[Audio] Load failed" and
// auto-skip through the whole queue. Routing playback through /play below
// fixes that: the browser only ever talks to this server, which fetches
// the real bytes itself (same IP that resolved the URL) and pipes them
// through — no changes needed on the client side.
app.get('/audio-url/:videoId', async (req, res) => {
  const { videoId } = req.params;
  const title       = req.query.title || '';

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'Invalid YouTube video ID' });
  }

  try {
    const start    = Date.now();
    await resolveEntry(videoId, title, PLAYER_CLIENTS, req.query.prefetch === '1' ? 'low' : 'high'); // resolves + warms the cache; actual bytes come from /play
    const elapsed  = Date.now() - start;
    const fromCache = elapsed < 10; // cache hits return in <10ms

    return res.json({
      ok:      true,
      url:     buildPlayUrl(req, videoId),
      videoId,
      source:  fromCache ? 'cache' : 'yt-dlp',
      ms:      elapsed
    });

  } catch (err) {
    console.error(`[Stream] Error for ${videoId}:`, err.message);
    return res.status(500).json({
      ok:      false,
      error:   'Could not resolve audio stream',
      detail:  err.message,
      videoId,
      hint:    'Video may be region-locked or unavailable'
    });
  }
});

// Last-resort fallback for /play: let yt-dlp itself download the audio and stream
// it to the client (stdout). yt-dlp requests the CDN exactly as YouTube expects
// (PO token, chunked ranges), which works for videos whose resolved URL the CDN
// refuses when fetched directly. No Range support — the app downloads the whole
// file as a blob anyway.
const streamViaYtDlp = (req, res, videoId) => new Promise((resolve) => {
  const args = [
    '-f', 'bestaudio[ext=m4a]/18/best[ext=mp4]',
    '--no-playlist', '--quiet', '--no-warnings',
    '--socket-timeout', '10',
    '--extractor-args', 'youtube:player_client=mweb',
    '--remote-components', 'ejs:github',
    '-o', '-',
    `https://www.youtube.com/watch?v=${videoId}`
  ];
  console.log(`[Proxy] Falling back to yt-dlp direct download for ${videoId}`);
  const child = spawn('yt-dlp', args);
  let gotData = false;
  let errTail = '';

  child.stderr.on('data', d => { errTail = (errTail + d.toString()).slice(-400); });
  child.stdout.once('data', (first) => {
    gotData = true;
    res.status(200);
    res.setHeader('Content-Type', 'audio/mp4');
    res.setHeader('Accept-Ranges', 'none');
    res.write(first);
    child.stdout.pipe(res);
  });
  child.on('error', (e) => {
    if (!res.headersSent) res.status(502).json({ error: 'yt-dlp could not start', detail: e.message, videoId });
    resolve();
  });
  child.on('close', (code) => {
    if (!gotData && !res.headersSent) {
      console.error(`[Proxy] yt-dlp direct download failed for ${videoId} (exit ${code}): ${errTail.trim()}`);
      res.status(502).json({ error: 'Failed to proxy stream', detail: errTail.trim() || `yt-dlp exit ${code}`, videoId });
    } else if (gotData) {
      console.log(`[Proxy] yt-dlp direct download finished for ${videoId} (exit ${code})`);
    }
    resolve();
  });
  req.on('close', () => child.kill());
});

// ── GET /play/:videoId ─────────────────────────────────────────────────
// ACTUAL PLAYBACK ENDPOINT. Streams the audio to the client through THIS
// server (same IP that resolved the URL). Like yt-dlp itself, it fetches the
// CDN in bounded ~10MB chunks: googlevideo refuses plain/open-ended requests
// for some videos. Order of attempts:
//   1. chunked fetch (Range header, then &range= query param)
//   2. re-resolve with the other player client and retry
//   3. let yt-dlp download + stream the audio itself
const CHUNK = 10 * 1024 * 1024;

const fetchChunk = async (entry, from, to) => {
  const headers = { ...entry.headers };
  delete headers.Range;
  const sep = entry.url.includes('?') ? '&' : '?';
  const attempts = [
    { url: entry.url,                              headers: { ...headers, Range: `bytes=${from}-${to}` }, mode: 'header' },
    { url: `${entry.url}${sep}range=${from}-${to}`, headers,                                              mode: 'param'  }
  ];
  let last;
  for (const a of attempts) {
    const r = await axios.get(a.url, { responseType: 'stream', headers: a.headers, timeout: 20000, validateStatus: () => true });
    if (r.status < 400) return { r, mode: a.mode };
    r.data.destroy?.();
    last = r.status;
  }
  const e = new Error(`CDN refused chunk ${from}-${to} (status ${last})`);
  e.status = last;
  throw e;
};

// Streams [start..end] of the file to res. Throws BEFORE sending anything if
// the first chunk is refused, so the caller can fall back.
const proxyChunked = async (req, res, entry, total, clientRange) => {
  let start = 0, end = total - 1;
  const m = /bytes=(\d*)-(\d*)/.exec(clientRange || '');
  if (m) {
    if (m[1] !== '') { start = parseInt(m[1], 10); if (m[2] !== '') end = Math.min(end, parseInt(m[2], 10)); }
    else if (m[2] !== '') start = Math.max(0, total - parseInt(m[2], 10)); // suffix range
  }
  if (start > end || start >= total) { res.status(416).setHeader('Content-Range', `bytes */${total}`); return res.end(); }

  const mime = decodeURIComponent((entry.url.match(/[?&]mime=([^&]+)/) || [])[1] || 'audio%2Fmp4');
  let pos = start;
  let aborted = false;
  let current = null;
  req.on('close', () => { aborted = true; current?.destroy?.(); });

  const firstEnd = Math.min(pos + CHUNK - 1, end);
  const first = await fetchChunk(entry, pos, firstEnd); // may throw → nothing sent yet

  res.status(clientRange ? 206 : 200);
  res.setHeader('Content-Type', mime);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Length', String(end - start + 1));
  if (clientRange) res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);

  let chunk = first;
  while (true) {
    current = chunk.r.data;
    await new Promise((resolve, reject) => {
      current.on('error', reject);
      current.on('end', resolve);
      current.pipe(res, { end: false });
    });
    pos = Math.min(pos + CHUNK, end + 1);
    if (aborted || pos > end) break;
    chunk = await fetchChunk(entry, pos, Math.min(pos + CHUNK - 1, end));
  }
  res.end();
};

app.get('/play/:videoId', async (req, res) => {
  const { videoId } = req.params;
  const title       = req.query.title || '';

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'Invalid YouTube video ID' });
  }

  const clientRange = req.headers.range;
  const totalOf = (entry) => parseInt((entry.url.match(/[?&]clen=(\d+)/) || [])[1], 10);

  const tryEntry = async (entry) => {
    const total = totalOf(entry);
    if (!total) throw new Error('no clen in URL');
    await proxyChunked(req, res, entry, total, clientRange);
  };

  try {
    let entry = await resolveEntry(videoId, title);
    try {
      await tryEntry(entry);
      return;
    } catch (e) {
      if (res.headersSent) throw e; // mid-stream failure: cannot fall back
      console.warn(`[Proxy] ${videoId} via ${entry.client} failed (${e.message}); retrying with another client`);
    }

    memCache.delete(videoId);
    try {
      const others = PLAYER_CLIENTS.filter(c => c !== entry.client);
      entry = await resolveEntry(videoId, title, others.length ? others : PLAYER_CLIENTS);
      await tryEntry(entry);
      return;
    } catch (e) {
      if (res.headersSent) throw e;
      console.warn(`[Proxy] Retry failed for ${videoId} (${e.message.slice(0, 150)})`);
    }

    memCache.delete(videoId);
    return streamViaYtDlp(req, res, videoId);

  } catch (err) {
    console.error(`[Proxy] Failed for ${videoId}:`, err.message);
    memCache.delete(videoId);
    if (!res.headersSent) return streamViaYtDlp(req, res, videoId);
    res.end();
  }
});

// ── GET /search-and-play?q=song+name ─────────────────────────────────
app.get('/search-and-play', (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Pass ?q=song name' });

  const safe = String(query).replace(/["`$\\]/g, ' ');
  const cmd  = `yt-dlp --print "%(title)s" --print "%(id)s" --skip-download --no-playlist --socket-timeout 10 --flat-playlist "ytsearch1:${safe} official audio"`;

  console.log(`\n[Search] "${query}"`);

  exec(cmd, { timeout: 30000 }, async (err, stdout, stderr) => {
    if (err) return res.status(500).json({ ok: false, error: stderr?.slice(-300) });

    const [title, videoId] = stdout.trim().split('\n').filter(Boolean);
    if (!title || !videoId) return res.status(404).json({ ok: false, error: 'No results' });

    try {
      await resolveEntry(videoId, title);
      console.log(`[Search] ✅ "${title}" (${videoId})`);
      res.json({
        ok:         true,
        title,
        videoId,
        audioUrl:   buildPlayUrl(req, videoId),
        youtubeUrl: `https://youtube.com/watch?v=${videoId}`
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, videoId });
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// CLOUDFLARE QUICK TUNNEL + URL REGISTRATION
// ══════════════════════════════════════════════════════════════════════
const registerUrl = async (url) => {
  if (!REGISTER_KEY) {
    console.warn('[Tunnel] STREAM_REGISTER_KEY is not set — the website will not learn this address.');
    return false;
  }
  // The backend (Render free tier) may be asleep; allow a slow first response and retry
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      await axios.post(`${BACKEND_URL}/api/stream-config`, { url }, {
        headers: { 'x-register-key': REGISTER_KEY },
        timeout: 60000
      });
      console.log(`[Tunnel] ✅ Registered with backend: ${url}`);
      return true;
    } catch (err) {
      const why = err.response ? `${err.response.status} ${err.response.data?.message || ''}` : err.message;
      console.warn(`[Tunnel] Register attempt ${attempt}/6 failed: ${why}`);
      if (err.response?.status === 401 || err.response?.status === 503) return false; // wrong/missing key — retrying won't help
      await new Promise(r => setTimeout(r, 5000 * attempt));
    }
  }
  return false;
};

let tunnelChild    = null;
let tunnelDisabled = false; // set when cloudflared isn't installed — retrying would never help
process.once('exit', () => { try { tunnelChild?.kill(); } catch {} });

const startTunnel = () => {
  if (tunnelDisabled) return;
  console.log('[Tunnel] Starting Cloudflare quick tunnel…');
  let child;
  try {
    // http2 (TCP) works on networks that block the default QUIC (UDP) transport
    child = spawn(CLOUDFLARED_PATH, ['tunnel', '--url', `http://localhost:${PORT}`, '--no-autoupdate', '--protocol', process.env.CLOUDFLARED_PROTOCOL || 'http2']);
  } catch (e) {
    return console.error('[Tunnel] Could not start cloudflared:', e.message);
  }

  const onOutput = (chunk) => {
    const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(chunk.toString());
    if (m && m[0] !== currentTunnelUrl) {
      currentTunnelUrl = m[0];
      console.log(`[Tunnel] Public address: ${currentTunnelUrl}`);
      registerUrl(currentTunnelUrl);
    }
  };
  // Surface cloudflared's own warnings/errors (otherwise connection problems are invisible)
  const showProblems = (chunk) => {
    chunk.toString().split('\n').filter(l => /\b(ERR|WRN)\b/.test(l)).forEach(l => console.warn(`[cloudflared] ${l.trim().slice(0, 220)}`));
  };
  child.stderr.on('data', onOutput);
  child.stdout.on('data', onOutput);
  child.stderr.on('data', showProblems);

  tunnelChild = child;

  child.on('error', (e) => {
    if (e.code === 'ENOENT') {
      tunnelDisabled = true;
      console.error('[Tunnel] ❌ cloudflared was not found by this terminal.');
      console.error('         Install it, then CLOSE this terminal and open a NEW one (an already-open terminal');
      console.error('         does not see newly installed programs). Or set CLOUDFLARED_PATH to the full path of cloudflared.exe.');
      console.error('         Not retrying. The server itself keeps running (use ngrok with USE_NGROK=1 meanwhile).');
    } else {
      console.error(`[Tunnel] cloudflared failed to start (${e.message})`);
    }
  });
  child.on('close', (code) => {
    if (tunnelDisabled) return;
    console.warn(`[Tunnel] cloudflared exited (code ${code}); restarting in 5s — a new address will be registered`);
    currentTunnelUrl = null;
    setTimeout(startTunnel, 5000);
  });

};

// Re-announce the address every 10 minutes (covers backend restarts / DB resets)
setInterval(() => { if (currentTunnelUrl) registerUrl(currentTunnelUrl); }, 10 * 60 * 1000);

// ── Start ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅ VStream Stream Server → http://localhost:${PORT}`);
  console.log(`🔧 Node: ${NODE_PATH}`);
  console.log('\n📋 Endpoints:');
  console.log(`   /health          — server status + cache count`);
  console.log(`   /test            — quick yt-dlp test`);
  console.log(`   /audio-url/:id   — resolve YouTube videoId to a playable proxy URL`);
  console.log(`   /play/:id        — actual audio bytes (proxied, Range-aware)`);
  console.log(`   /cache-stats     — see what's cached`);
  console.log(`   /prefetch/:id    — pre-resolve next song (fire & forget)`);
  console.log(`   /search-and-play?q=... — search + resolve in one call`);
  console.log('\n🌐 Public address: starting a free Cloudflare quick tunnel (set USE_NGROK=1 to skip it and use ngrok instead)\n');
  if (!process.env.USE_NGROK) startTunnel();
});

//inde and playbar 2610


// const dotenv = require('dotenv');
// dotenv.config();

// const express    = require('express');
// const cors       = require('cors');
// const mongoose   = require('mongoose');
// const connectDB  = require('./config/db');
// const { startKeepAlive } = require('./keepAlive');

// const authRoutes     = require('./routes/authRoutes');
// const searchRoutes   = require('./routes/searchRoutes');
// const playlistRoutes = require('./routes/playlistRoutes');
// const profileRoutes  = require('./routes/profileRoutes');
// const adminRoutes    = require('./routes/adminRoutes');
// const streamRoutes   = require('./routes/streamRoutes'); // ← NEW
// const streamConfigRoutes = require('./routes/streamConfigRoutes');
   
// const importRoutes   = require('./routes/importRoutes');


// const startServer = async () => {
//   await connectDB();

//   // ── Fix: youtube_id index must be SPARSE ─────────────────────────
//   try {
//     const songsCol = mongoose.connection.db.collection('songs');
//     const indexes  = await songsCol.indexes();

//     const ytIndex = indexes.find(i => i.name === 'youtube_id_1');
//     if (ytIndex && !ytIndex.sparse) {
//       await songsCol.dropIndex('youtube_id_1');
//       await songsCol.createIndex(
//         { youtube_id: 1 },
//         { unique: true, sparse: true, name: 'youtube_id_1' }
//       );
//       console.log('[Startup] ✅ youtube_id index fixed (now sparse)');
//     }

//     const jsIndex = indexes.find(i => i.name === 'jiosaavn_id_1');
//     if (jsIndex && !jsIndex.sparse) {
//       await songsCol.dropIndex('jiosaavn_id_1');
//       await songsCol.createIndex(
//         { jiosaavn_id: 1 },
//         { unique: true, sparse: true, name: 'jiosaavn_id_1' }
//       );
//       console.log('[Startup] ✅ jiosaavn_id index fixed (now sparse)');
//     }
//   } catch (err) {
//     console.warn('[Startup] Index migration skipped:', err.message);
//   }

//   const app = express();
//   app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
//   app.use(express.json());

//   // Health check
//   app.get('/health', (req, res) => res.json({ status: 'ok', app: 'VStream' }));

//   // Email test
//   app.get('/test-email', async (req, res) => {
//     try {
//       const axios = require('axios');
//       await axios.post('https://api.brevo.com/v3/smtp/email', {
//         sender:      { name: 'VStream', email: process.env.EMAIL_USER },
//         to:          [{ email: process.env.EMAIL_USER }],
//         subject:     'VStream Email Test',
//         htmlContent: '<h1>Email working ✅</h1>'
//       }, {
//         headers: {
//           'api-key':      process.env.BREVO_API_KEY,
//           'Content-Type': 'application/json'
//         }
//       });
//       res.json({ status: 'Brevo connected ✅' });
//     } catch (err) {
//       res.json({ status: 'Brevo FAILED ❌', error: err.message });
//     }
//   });

//   app.use('/api/auth',      authRoutes);
//   app.use('/api/search',    searchRoutes);
//   app.use('/api/playlists', playlistRoutes);
//   app.use('/api/profile',   profileRoutes);
//   app.use('/api/admin',     adminRoutes);
//   app.use('/api/stream',    streamRoutes); // ← NEW
//   app.use('/api/stream-config', streamConfigRoutes);
//   app.use('/api/import',    importRoutes);

//   const PORT = process.env.PORT || 5000;
//   app.listen(PORT, () => {
//     console.log(`VStream server running on port ${PORT}`);
//     startKeepAlive();
//   });
// };

// startServer().catch(err => {
//   console.error('Failed to start:', err);
//   process.exit(1);
// });



// const dotenv = require('dotenv');
// dotenv.config();

// const express    = require('express');
// const cors       = require('cors');
// const mongoose   = require('mongoose');
// const connectDB  = require('./config/db');
// const { startKeepAlive } = require('./keepAlive');

// const authRoutes     = require('./routes/authRoutes');
// const searchRoutes   = require('./routes/searchRoutes');
// const playlistRoutes = require('./routes/playlistRoutes');
// const profileRoutes  = require('./routes/profileRoutes');
// const adminRoutes    = require('./routes/adminRoutes');
// //const streamRoutes   = require('./routes/streamRoutes'); // ← NEW

// const startServer = async () => {
//   await connectDB();

//   // ── Fix: youtube_id index must be SPARSE ─────────────────────────
//   try {
//     const songsCol = mongoose.connection.db.collection('songs');
//     const indexes  = await songsCol.indexes();

//     const ytIndex = indexes.find(i => i.name === 'youtube_id_1');
//     if (ytIndex && !ytIndex.sparse) {
//       await songsCol.dropIndex('youtube_id_1');
//       await songsCol.createIndex(
//         { youtube_id: 1 },
//         { unique: true, sparse: true, name: 'youtube_id_1' }
//       );
//       console.log('[Startup] ✅ youtube_id index fixed (now sparse)');
//     }

//     const jsIndex = indexes.find(i => i.name === 'jiosaavn_id_1');
//     if (jsIndex && !jsIndex.sparse) {
//       await songsCol.dropIndex('jiosaavn_id_1');
//       await songsCol.createIndex(
//         { jiosaavn_id: 1 },
//         { unique: true, sparse: true, name: 'jiosaavn_id_1' }
//       );
//       console.log('[Startup] ✅ jiosaavn_id index fixed (now sparse)');
//     }
//   } catch (err) {
//     console.warn('[Startup] Index migration skipped:', err.message);
//   }

//   const app = express();
//   app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
//   app.use(express.json());

//   // Health check
//   app.get('/health', (req, res) => res.json({ status: 'ok', app: 'VStream' }));

//   // Email test
//   app.get('/test-email', async (req, res) => {
//     try {
//       const axios = require('axios');
//       await axios.post('https://api.brevo.com/v3/smtp/email', {
//         sender:      { name: 'VStream', email: process.env.EMAIL_USER },
//         to:          [{ email: process.env.EMAIL_USER }],
//         subject:     'VStream Email Test',
//         htmlContent: '<h1>Email working ✅</h1>'
//       }, {
//         headers: {
//           'api-key':      process.env.BREVO_API_KEY,
//           'Content-Type': 'application/json'
//         }
//       });
//       res.json({ status: 'Brevo connected ✅' });
//     } catch (err) {
//       res.json({ status: 'Brevo FAILED ❌', error: err.message });
//     }
//   });

//   app.use('/api/auth',      authRoutes);
//   app.use('/api/search',    searchRoutes);
//   app.use('/api/playlists', playlistRoutes);
//   app.use('/api/profile',   profileRoutes);
//   app.use('/api/admin',     adminRoutes);
//   //app.use('/api/stream',    streamRoutes); // ← NEW

//   const PORT = process.env.PORT || 5000;
//   app.listen(PORT, () => {
//     console.log(`VStream server running on port ${PORT}`);
//     startKeepAlive();
//   });
// };

// startServer().catch(err => {
//   console.error('Failed to start:', err);
//   process.exit(1);
// });


//search,index,stream

// const dotenv = require('dotenv');
// dotenv.config();

// const express    = require('express');
// const cors       = require('cors');
// const connectDB  = require('./config/db');
// const { startKeepAlive } = require('./keepAlive');

// const authRoutes     = require('./routes/authRoutes');
// const searchRoutes   = require('./routes/searchRoutes');
// const playlistRoutes = require('./routes/playlistRoutes');
// const profileRoutes  = require('./routes/profileRoutes');
// const adminRoutes    = require('./routes/adminRoutes');

// connectDB();

// const app = express();
// app.use(cors({ origin: '*' }));
// app.use(express.json());

// app.get('/health', (req, res) => res.json({ status: 'ok', app: 'VStream' }));

// app.get('/test-email', async (req, res) => {
//   try {
//     const axios = require('axios');
//     await axios.post('https://api.brevo.com/v3/smtp/email', {
//       sender: { name: 'VStream', email: process.env.EMAIL_USER },
//       to: [{ email: process.env.EMAIL_USER }],
//       subject: 'VStream Email Test',
//       htmlContent: '<h1>Email working ✅</h1>'
//     }, {
//       headers: {
//         'api-key': process.env.BREVO_API_KEY,
//         'Content-Type': 'application/json'
//       }
//     });
//     res.json({
//       status: 'Brevo HTTP API connected ✅',
//       user: process.env.EMAIL_USER,
//       apiKeyLength: process.env.BREVO_API_KEY?.length
//     });
//   } catch (err) {
//     res.json({
//       status: 'Brevo FAILED ❌',
//       error: err.response?.data?.message || err.message,
//       apiKeyLength: process.env.BREVO_API_KEY?.length
//     });
//   }
// });

// app.use('/api/auth',      authRoutes);
// app.use('/api/search',    searchRoutes);
// app.use('/api/playlists', playlistRoutes);
// app.use('/api/profile',   profileRoutes);
// app.use('/api/admin',     adminRoutes);   // ← NEW

// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => {
//   console.log(`VStream server running on port ${PORT}`);
//   startKeepAlive();
// });



//admin
// const dotenv = require('dotenv');
// dotenv.config();

// const express    = require('express');
// const cors       = require('cors');
// const connectDB  = require('./config/db');
// const { startKeepAlive } = require('./keepAlive');

// const authRoutes     = require('./routes/authRoutes');
// const searchRoutes   = require('./routes/searchRoutes');
// const playlistRoutes = require('./routes/playlistRoutes');
// const profileRoutes  = require('./routes/profileRoutes');

// connectDB();

// const app = express();
// app.use(cors({ origin: '*' }));
// app.use(express.json());

// app.get('/health', (req, res) => res.json({ status: 'ok', app: 'VStream' }));

// app.get('/test-email', async (req, res) => {
//   try {
//     const axios = require('axios');
//     // Test Brevo HTTP API by sending a real test email
//     await axios.post('https://api.brevo.com/v3/smtp/email', {
//       sender: { name: 'VStream', email: process.env.EMAIL_USER },
//       to: [{ email: process.env.EMAIL_USER }],
//       subject: 'VStream Email Test',
//       htmlContent: '<h1>Email working ✅</h1>'
//     }, {
//       headers: {
//         'api-key': process.env.BREVO_API_KEY,
//         'Content-Type': 'application/json'
//       }
//     });
//     res.json({
//       status: 'Brevo HTTP API connected ✅',
//       user: process.env.EMAIL_USER,
//       apiKeyLength: process.env.BREVO_API_KEY?.length
//     });
//   } catch (err) {
//     res.json({
//       status: 'Brevo FAILED ❌',
//       error: err.response?.data?.message || err.message,
//       apiKeyLength: process.env.BREVO_API_KEY?.length
//     });
//   }
// });

// app.use('/api/auth',      authRoutes);
// app.use('/api/search',    searchRoutes);
// app.use('/api/playlists', playlistRoutes);
// app.use('/api/profile',   profileRoutes);

// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => {
//   console.log(`VStream server running on port ${PORT}`);
//   startKeepAlive();
// });




// const dotenv = require('dotenv');
// dotenv.config();

// const express    = require('express');
// const cors       = require('cors');
// const connectDB  = require('./config/db');
// const { startKeepAlive } = require('./keepAlive');

// const authRoutes     = require('./routes/authRoutes');
// const searchRoutes   = require('./routes/searchRoutes');
// const playlistRoutes = require('./routes/playlistRoutes');

// connectDB();

// const app = express();
// app.use(cors({ origin: '*' }));
// app.use(express.json());

// app.get('/health', (req, res) => res.json({ status: 'ok', app: 'VStream' }));

// app.get('/test-email', async (req, res) => {
//   try {
//     const axios = require('axios');
//     // Test Brevo HTTP API by sending a real test email
//     await axios.post('https://api.brevo.com/v3/smtp/email', {
//       sender: { name: 'VStream', email: process.env.EMAIL_USER },
//       to: [{ email: process.env.EMAIL_USER }],
//       subject: 'VStream Email Test',
//       htmlContent: '<h1>Email working ✅</h1>'
//     }, {
//       headers: {
//         'api-key': process.env.BREVO_API_KEY,
//         'Content-Type': 'application/json'
//       }
//     });
//     res.json({
//       status: 'Brevo HTTP API connected ✅',
//       user: process.env.EMAIL_USER,
//       apiKeyLength: process.env.BREVO_API_KEY?.length
//     });
//   } catch (err) {
//     res.json({
//       status: 'Brevo FAILED ❌',
//       error: err.response?.data?.message || err.message,
//       apiKeyLength: process.env.BREVO_API_KEY?.length
//     });
//   }
// });

// app.use('/api/auth',      authRoutes);
// app.use('/api/search',    searchRoutes);
// app.use('/api/playlists', playlistRoutes);

// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => {
//   console.log(`VStream server running on port ${PORT}`);
//   startKeepAlive();
// });


//httpapi


// const dotenv = require('dotenv');
// dotenv.config();

// const express    = require('express');
// const cors       = require('cors');
// const connectDB  = require('./config/db');
// const { startKeepAlive } = require('./keepAlive');

// const authRoutes     = require('./routes/authRoutes');
// const searchRoutes   = require('./routes/searchRoutes');
// const playlistRoutes = require('./routes/playlistRoutes');

// connectDB();

// const app = express();
// app.use(cors({ origin: '*' }));
// app.use(express.json());

// app.get('/health', (req, res) => res.json({ status: 'ok', app: 'VStream' }));

// app.get('/test-email', async (req, res) => {
//   try {
//     const nodemailer = require('nodemailer');
//     const transporter = nodemailer.createTransport({
//       host: 'smtp-relay.brevo.com',
//       port: 587,
//       secure: false,
//       auth: {
//         user: process.env.EMAIL_USER,
//         pass: process.env.BREVO_SMTP_KEY
//       }
//     });
//     await transporter.verify();
//     res.json({
//       status: 'Brevo connected ✅',
//       user: process.env.EMAIL_USER,
//       passLength: process.env.BREVO_SMTP_KEY?.length
//     });
//   } catch (err) {
//     res.json({
//       status: 'Brevo FAILED ❌',
//       error: err.message,
//       user: process.env.EMAIL_USER,
//       passLength: process.env.BREVO_SMTP_KEY?.length
//     });
//   }
// });

// app.use('/api/auth',      authRoutes);
// app.use('/api/search',    searchRoutes);
// app.use('/api/playlists', playlistRoutes);

// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => {
//   console.log(`VStream server running on port ${PORT}`);
//   startKeepAlive();
// });


// const dotenv = require('dotenv');
// dotenv.config(); // ✅ Must be FIRST

// const express = require('express');
// const cors    = require('cors');
// const connectDB = require('./config/db');
// const { startKeepAlive } = require('./keepAlive');

// // Routes
// const authRoutes     = require('./routes/authRoutes');
// const searchRoutes   = require('./routes/searchRoutes');
// const playlistRoutes = require('./routes/playlistRoutes');

// connectDB();

// const app = express();

// app.use(cors({ origin: '*' }));
// app.use(express.json());

// // Health check endpoint
// app.get('/health', (req, res) => res.json({ status: 'ok', app: 'VStream' }));

// // ✅ Email test endpoint — visit this URL to test Gmail
// app.get('/test-email', async (req, res) => {
//   try {
//     const nodemailer = require('nodemailer');
//     const transporter = nodemailer.createTransport({
//       service: 'gmail',
//       auth: {
//         user: process.env.EMAIL_USER,
//         pass: process.env.EMAIL_PASS
//       }
//     });
//     await transporter.verify();
//     res.json({ 
//       status: 'Gmail connected ✅',
//       user: process.env.EMAIL_USER,
//       passLength: process.env.EMAIL_PASS?.length
//     });
//   } catch (err) {
//     res.json({ 
//       status: 'Gmail FAILED ❌',
//       error: err.message,
//       user: process.env.EMAIL_USER,
//       passLength: process.env.EMAIL_PASS?.length
//     });
//   }
// });

// app.use('/api/auth',      authRoutes);
// app.use('/api/search',    searchRoutes);
// app.use('/api/playlists', playlistRoutes);

// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => {
//   console.log(`VStream server running on port ${PORT}`);
//   startKeepAlive(); // ✅ Start keep-alive pings (only active on Render)
// });


 //email testing



// const dotenv = require('dotenv');
// dotenv.config(); // ✅ Must be FIRST

// const express = require('express');
// const cors    = require('cors');
// const connectDB = require('./config/db');
// const { startKeepAlive } = require('./keepAlive');

// // Routes
// const authRoutes     = require('./routes/authRoutes');
// const searchRoutes   = require('./routes/searchRoutes');
// const playlistRoutes = require('./routes/playlistRoutes');

// connectDB();

// const app = express();

// app.use(cors({ origin: '*' }));
// app.use(express.json());

// // Health check endpoint — used by keepAlive ping
// app.get('/health', (req, res) => res.json({ status: 'ok', app: 'VStream' }));

// app.use('/api/auth',      authRoutes);
// app.use('/api/search',    searchRoutes);
// app.use('/api/playlists', playlistRoutes);

// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => {
//   console.log(`VStream server running on port ${PORT}`);
//   startKeepAlive(); // ✅ Start keep-alive pings (only active on Render)
// });

// to keep server alive 



// const dotenv = require('dotenv');
// dotenv.config(); // ✅ Must be FIRST before any other require that uses process.env

// const express = require('express');
// const cors = require('cors');
// const connectDB = require('./config/db');

// // Routes
// const authRoutes = require('./routes/authRoutes');
// const searchRoutes = require('./routes/searchRoutes');
// const playlistRoutes = require('./routes/playlistRoutes');

// connectDB();

// const app = express();

// app.use(cors());
// // app.use(cors({ origin: '*' }));
// app.use(express.json());

// app.use('/api/auth', authRoutes);
// app.use('/api/search', searchRoutes);
// app.use('/api/playlists', playlistRoutes);

// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
//cluade 8
// const express = require('express');
// const dotenv = require('dotenv');
// const cors = require('cors');
// const connectDB = require('./config/db');

// // Routes
// const authRoutes = require('./routes/authRoutes');
// const searchRoutes = require('./routes/searchRoutes');
// const playlistRoutes = require('./routes/playlistRoutes');

// dotenv.config();
// connectDB();

// const app = express();

// app.use(cors());
// app.use(express.json());

// app.use('/api/auth', authRoutes);
// app.use('/api/search', searchRoutes);
// app.use('/api/playlists', playlistRoutes);

// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
