// Every song's debut, last show and play count, live from the Biscuits Internet Project.
//   GET /api/songs -> compact() in functions/_songs.js, plus { fetched: ISO time }
// BIP's catalog is about 2 MB, so the trimmed copy is cached at the edge for FRESH_SECONDS. A second
// copy is kept for STALE_SECONDS and served if BIP is down when the fresh one has expired.

import { json } from '../_shared.js';
import { BIP, compact } from '../_songs.js';

const FRESH_SECONDS = 6 * 3600;
const STALE_SECONDS = 30 * 86400;
const BROWSER_SECONDS = 3600;

export async function onRequestGet({ request, waitUntil }) {
  const cache = caches.default;
  const fresh = new Request(new URL('/api/songs', request.url).toString());
  const stale = new Request(new URL('/api/songs?stale', request.url).toString());
  const hit = await cache.match(fresh);
  if (hit) return withCaching(new Response(hit.body, hit), BROWSER_SECONDS);

  let body;
  try {
    const r = await fetch(`${BIP}/api/songs`, { headers: { 'User-Agent': 'biscomusic.com (Biscuits Jam Radio)' } });
    if (!r.ok) throw new Error(`BIP answered ${r.status}`);
    body = JSON.stringify({ fetched: new Date().toISOString(), ...compact(await r.json()) });
  } catch (e) {
    const old = await cache.match(stale);
    if (old) return withCaching(new Response(old.body, old), BROWSER_SECONDS);
    return json({ error: 'The song catalog is unavailable right now.' }, 502);
  }

  const res = new Response(body, { headers: { 'Content-Type': 'application/json' } });
  waitUntil(cache.put(fresh, withCaching(res.clone(), FRESH_SECONDS)));
  waitUntil(cache.put(stale, withCaching(res.clone(), STALE_SECONDS)));
  return withCaching(res, BROWSER_SECONDS);
}

function withCaching(res, seconds) {
  res.headers.set('Cache-Control', `public, max-age=${seconds}`);
  return res;
}
