/* Service Worker — keeps app alive in background for audio playback */
const CACHE_NAME = 'vstream-v1';

// Install — cache basic app shell
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(['/', '/index.html'])
    )
  );
});

// Activate
self.addEventListener('activate', (e) => {
  self.clients.claim();
  // Remove old caches
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
});

// Fetch — serve from cache when offline, network first when online
self.addEventListener('fetch', (e) => {
  // Don't intercept API calls or YouTube
  if (e.request.url.includes('/api/') ||
      e.request.url.includes('youtube') ||
      e.request.url.includes('googleapis')) {
    return;
  }
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

// Keep alive — respond to messages from main page
self.addEventListener('message', (e) => {
  if (e.data === 'keepAlive') {
    e.ports[0]?.postMessage('alive');
  }
});