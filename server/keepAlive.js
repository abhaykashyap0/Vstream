// keepAlive.js — place in server/ folder
// Pings the server itself every 14 minutes to prevent Render free tier sleep

const https = require('https');

const SELF_URL = process.env.RENDER_EXTERNAL_URL || process.env.SELF_URL;
const INTERVAL = 14 * 60 * 1000; // 14 minutes

const ping = () => {
  if (!SELF_URL) return; // Only runs in production on Render

  const url = `${SELF_URL}/api/search/suggestions`;
  https.get(url, (res) => {
    console.log(`[KeepAlive] Pinged ${url} — status: ${res.statusCode}`);
  }).on('error', (err) => {
    console.warn(`[KeepAlive] Ping failed:`, err.message);
  });
};

// Start pinging after 1 minute (let server boot first)
const startKeepAlive = () => {
  if (!SELF_URL) {
    console.log('[KeepAlive] No SELF_URL set — skipping (local dev mode)');
    return;
  }
  console.log(`[KeepAlive] Started — pinging every 14 minutes`);
  setTimeout(() => {
    ping();
    setInterval(ping, INTERVAL);
  }, 60 * 1000);
};

module.exports = { startKeepAlive };