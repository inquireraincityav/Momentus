// Hygd shift service worker.
//
// Scope: only /today, /tomorrow, their JS/CSS, and the single-day /api/events
// read used to populate them. Everything else (the full Calendar page, uploads,
// analytics, comments) goes straight to the network — we intentionally stay out
// of their way until Phase 1 proves itself.
//
// Strategy:
//   • Shell (manifest, shift.js, style.css, Bootstrap CDN) — cache-first
//   • /today and /tomorrow HTML — network-first, cache on success
//   • GET /api/events?... — network-first, cache on success, fall back to cache
//   • Writes (POST/DELETE) — pass through. The page's outbox retries on reconnect.

const CACHE = 'hygd-shift-v1';

const SHELL = [
  '/today',
  '/tomorrow',
  '/static/shift.js',
  '/static/style.css',
  '/static/manifest.json',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Shell adds are best-effort — a 404 on any one must not break install.
    await Promise.all(SHELL.map(async url => {
      try { await cache.add(url); } catch (_) { /* swallow */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isShiftHtml(url) {
  return url.pathname === '/today' || url.pathname === '/tomorrow';
}
function isApiRead(url) {
  return url.pathname === '/api/events';
}
function isCacheableStatic(url) {
  return url.pathname.startsWith('/static/') ||
         url.hostname === 'cdn.jsdelivr.net';
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // writes pass through; the outbox handles them

  const url = new URL(req.url);
  if (isShiftHtml(url) || isApiRead(url)) {
    event.respondWith(networkFirst(req));
  } else if (isCacheableStatic(url)) {
    event.respondWith(cacheFirst(req));
  }
  // Anything else: default browser behaviour.
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const resp = await fetch(req);
    if (resp && resp.ok) {
      // Cache a clone so the same URL works when the network drops.
      cache.put(req, resp.clone()).catch(() => {});
    }
    return resp;
  } catch (e) {
    const cached = await cache.match(req);
    if (cached) return cached;
    // Last resort for the HTML: serve any cached shift page so the shell renders.
    if (isShiftHtml(new URL(req.url))) {
      const fallback = await cache.match('/today') || await cache.match('/tomorrow');
      if (fallback) return fallback;
    }
    throw e;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  const resp = await fetch(req);
  if (resp && resp.ok) cache.put(req, resp.clone()).catch(() => {});
  return resp;
}
