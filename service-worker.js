const CACHE_NAME = 'calm-breathing-v4';

// How long to wait for the network before falling back to the cache. Long
// enough to ride out a slow connection, short enough that a dead one does not
// leave you staring at a blank screen.
const NETWORK_TIMEOUT_MS = 2500;

const FILES_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/engine.js',
  './js/patterns.js',
  './js/storage.js',
  './js/audio.js',
  './js/health.js',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(FILES_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

function fetchWithTimeout(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  // 'no-cache' revalidates with the server rather than silently reusing the
  // browser's HTTP cache — otherwise "network-first" can still hand back a
  // stale copy and defeat the point. Unchanged files still cost only a 304.
  return fetch(request, { signal: controller.signal, cache: 'no-cache' })
    .finally(() => clearTimeout(timer));
}

// Network-first: a deploy is live on the very next launch rather than the one
// after. The cache is the offline safety net, not the default source.
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetchWithTimeout(request);
    if (response && response.status === 200 && response.type === 'basic') {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;

    // A navigation with a query string (?foo=1) will not match the cached
    // shell on its own, so retry ignoring the search params.
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html', { ignoreSearch: true });
      if (shell) return shell;
    }

    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(networkFirst(request));
});
