/* Service Worker — VStream */
const CACHE_NAME = 'vstream-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  self.clients.claim();
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
});

// ✅ Fixed fetch handler — skip non-GET and opaque requests
self.addEventListener('fetch', (e) => {
  // Only handle GET requests
  if (e.request.method !== 'GET') return;

  // Skip API calls, YouTube, Firebase, external URLs
  const url = e.request.url;
  if (
    url.includes('/api/') ||
    url.includes('youtube') ||
    url.includes('googleapis') ||
    url.includes('firebase') ||
    url.includes('lrclib') ||
    url.includes('anthropic') ||
    !url.startsWith('http')
  ) return;

  e.respondWith(
    fetch(e.request)
      .then(response => {
        // Only cache valid same-origin responses
        if (
          !response ||
          response.status !== 200 ||
          response.type === 'opaque' ||
          response.type === 'error'
        ) {
          return response;
        }
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'keepAlive') {
    e.ports[0]?.postMessage('alive');
  }
});