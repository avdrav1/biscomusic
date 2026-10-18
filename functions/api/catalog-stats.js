// Per-track numbers for the request sheet's shortcuts, cached for a minute.
//   GET /api/catalog-stats -> { hot: { track: score }, last_played: { track: ms } }
// hot = reactions + 2 x visible comments (the same weighting as /api/best).

import { json } from '../_shared.js';

export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const key = new Request(new URL('/api/catalog-stats', request.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;

  const [fire, talk, plays] = await env.DB.batch([
    env.DB.prepare('SELECT track, COUNT(*) AS n FROM reactions GROUP BY track'),
    env.DB.prepare('SELECT track, COUNT(*) AS n FROM comments WHERE hidden = 0 GROUP BY track'),
    env.DB.prepare('SELECT track, MAX(started_at) AS at FROM plays GROUP BY track'),
  ]);
  const hot = {};
  fire.results.forEach(r => { hot[r.track] = (hot[r.track] || 0) + r.n; });
  talk.results.forEach(r => { hot[r.track] = (hot[r.track] || 0) + 2 * r.n; });
  const last_played = Object.fromEntries(plays.results.map(r => [r.track, r.at]));

  const res = json({ hot, last_played });
  res.headers.set('Cache-Control', 'public, max-age=60');
  waitUntil(cache.put(key, res.clone()));
  return res;
}
