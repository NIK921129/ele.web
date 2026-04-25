const CACHE_NAME = 'wattzen-cache-v1';
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/wmremove-transformed.png'
];

// Install the Service Worker and Cache Static Assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(URLS_TO_CACHE);
      })
  );
  self.skipWaiting();
});

// Activate and Clean Up Old Caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Intercept Fetch Requests for Offline Support
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  // Bypass caching for dynamic API requests and Socket connections
  if (event.request.url.includes('/api/') || event.request.url.includes('socket.io') || event.request.url.includes('chrome-extension')) return;

  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
        }
        return networkResponse;
      });
    }).catch(() => {
      // Fallback for offline un-cached pages (SPA Routing)
      if (event.request.mode === 'navigate') {
        return caches.match('/index.html');
      }
    })
  );
});