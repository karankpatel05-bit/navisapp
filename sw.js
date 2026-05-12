// Navis PWA Service Worker
const CACHE_NAME = 'navis-v1';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './style.css',
  './connection.css',
  './manifest.json',
  './images/robomanthan_logo.png',
  './images/icon-192.png',
  './images/icon-512.png'
];

// Install: cache app shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: serve from cache, fall back to network
self.addEventListener('fetch', event => {
  // For API calls (Groq, Google TTS, WebSocket) always go to network
  const url = event.request.url;
  if (url.includes('groq.com') || url.includes('translate.google.com') || url.startsWith('ws')) {
    return; // let browser handle it normally
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
