const CACHE_NAME = 'calm-breathing-v7';

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
  './js/insights.js',
  './js/charts.js',
  './js/celebrate.js',
  './js/intents.js',
  './js/display.js',
  './js/sharecard.js',
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
/**
 * Audio tracks are cache-first and never precached.
 *
 * They are large and optional — precaching would make the very first load pay
 * for several megabytes of music before the app appears, and revalidating on
 * every launch would re-download it. Once fetched it never needs checking
 * again: a changed track means a changed filename.
 */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    // 206 Partial Content comes back for ranged media requests and must not be
    // cached — a partial response would be served as if it were the whole file.
    if (response && response.status === 200 && response.type === 'basic') {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return Response.error();
  }
}

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
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/audio/') || /\.(mp3|m4a|ogg|wav)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(networkFirst(request));
});
