// client/src/utils/streamServer.js
// Shared helpers for talking to the stream server running on your PC.
import axios from 'axios';

const API = process.env.REACT_APP_API_URL || '';

// The stream server's public address changes whenever its free tunnel restarts, so the
// site asks the backend for the current one. The ngrok address is only a last resort.
const FALLBACK_STREAM_SERVER = 'https://rancidity-retrain-glacier.ngrok-free.dev';
let streamBase        = null;   // cached address
let streamBasePromise = null;   // in-flight lookup (shared)

export const NGROK_HEADERS = { 'ngrok-skip-browser-warning': 'true' };

export const getStreamBase = (forceRefresh = false) => {
  if (streamBase && !forceRefresh) return Promise.resolve(streamBase);
  if (streamBasePromise) return streamBasePromise;
  streamBasePromise = axios.get(`${API}/api/stream-config`, { timeout: 30000 })
    .then(({ data }) => { streamBase = (data?.ok && data.url) ? data.url : (streamBase || FALLBACK_STREAM_SERVER); return streamBase; })
    .catch(() => { streamBase = streamBase || FALLBACK_STREAM_SERVER; return streamBase; })
    .finally(() => { streamBasePromise = null; });
  return streamBasePromise;
};

// Asks the stream server to resolve and save every YouTube song of a playlist in the
// background, so pressing play later has no wait. Fire and forget; safe to call often.
const recentlyWarmed = new Map(); // videoId → timestamp
const WARM_AGAIN_AFTER_MS = 30 * 60 * 1000;

export const warmSongs = async (songs = []) => {
  try {
    const now = Date.now();
    const seen = new Set();
    const ids = [];
    for (const s of songs) {
      const id = s?.youtube_id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      if (now - (recentlyWarmed.get(id) || 0) < WARM_AGAIN_AFTER_MS) continue;
      recentlyWarmed.set(id, now);
      ids.push({ id, title: s.title || '' });
    }
    if (!ids.length) return;

    const post = async () => axios.post(`${await getStreamBase()}/warm`, { ids }, { headers: NGROK_HEADERS, timeout: 15000 });
    try {
      await post();
    } catch (e) {
      if (e.response) throw e;      // server answered with an error — don't retry
      await getStreamBase(true);    // no answer: the tunnel address may have changed
      await post();
    }
    console.log(`[Warm] Asked the stream server to prepare ${ids.length} song(s)`);
  } catch {
    // Warming is an optimisation only — never show an error
  }
};