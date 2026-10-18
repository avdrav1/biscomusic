// What's on air, what's next, and the live vote count.
//   GET /api/station -> view() in functions/_station.js
// Every listener polls this, so it's cached at the edge for 2s (the state itself advances lazily here).

import { json } from '../_shared.js';
import { getStation } from '../_station.js';

const CACHE_SECONDS = 2;

export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const key = new Request(new URL('/api/station', request.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;

  const { view } = await getStation(env, request);
  const res = json(view);
  res.headers.set('Cache-Control', `public, max-age=${CACHE_SECONDS}`);
  waitUntil(cache.put(key, res.clone()));
  return res;
}
