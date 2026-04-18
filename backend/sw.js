const CACHE_NAME = 'wattzen-cache-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).then((networkResponse) => {
      // Network-First Strategy: Seamlessly update cache with the latest deployment version
      if (networkResponse && networkResponse.status === 200) {
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
      }
      return networkResponse;
    }).catch(async () => {
      const cachedResponse = await caches.match(event.request);
      if (cachedResponse) return cachedResponse;
      
      // 7. Offline SPA Fallback: Serve index.html shell for deep links when offline
      if (event.request.mode === 'navigate') return caches.match('/index.html');
      
      return new Response('', { status: 404, statusText: 'Not Found' });
    })
  );
});