// Service worker: makes Jam Radio open instantly and work as an installed app.
// build.py stamps VERSION and PRECACHE into site/sw.js; this source file works as-is too
// (server.py serves it with nothing precached, so local mode just goes to the network).
const VERSION = 'dev';
const PRECACHE = [];

const CACHE = `jamradio-${VERSION}`;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('jamradio-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  // Leave alone: other origins (the audio on R2, Turnstile, Nugs), the live API, and non-GETs.
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') return e.respondWith(page(req));
  // Versioned files (?v=<hash>) and fonts never change under the same URL: cache first.
  if (url.searchParams.has('v') || url.pathname.startsWith('/static/fonts/')) return e.respondWith(cacheFirst(req));
  e.respondWith(networkFirst(req));   // schedule.json, waveforms, everything else
});

// Pages: always try the network (so a deploy shows up), fall back to the cached copy offline.
async function page(req) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
    return res;
  } catch {
    const cache = await caches.open(CACHE);
    return (await cache.match(req, { ignoreSearch: true })) || (await cache.match('/')) || Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE), hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req)) || Response.error();
  }
}
