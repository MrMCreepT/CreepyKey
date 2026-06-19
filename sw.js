const CACHE_NAME = 'key-analyser-v8';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './app.js',
    './worker.js',
    './manifest.json',
    'https://cdn.jsdelivr.net/npm/browser-id3-writer@4.4.0/dist/browser-id3-writer.min.js',
    'https://unpkg.com/wavesurfer.js@7/dist/wavesurfer.min.js'
];

self.addEventListener('install', event => {
    self.skipWaiting(); // Force the waiting service worker to become active immediately
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS_TO_CACHE))
    );
});

self.addEventListener('activate', event => {
    // Clear old caches
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cache => {
                    if (cache !== CACHE_NAME) {
                        return caches.delete(cache);
                    }
                })
            );
        }).then(() => self.clients.claim()) // Claim clients immediately
    );
});

// Network-first fetch strategy
self.addEventListener('fetch', event => {
    // Only handle HTTP/HTTPS requests (avoid chrome-extension:// or file://)
    if (!event.request.url.startsWith('http')) return;

    event.respondWith(
        fetch(event.request)
            .then(response => {
                if (response && response.status === 200) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, responseClone);
                    });
                }
                return response;
            })
            .catch(() => {
                return caches.match(event.request);
            })
    );
});
