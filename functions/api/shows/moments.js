// The show radio's comments and flame counts for a whole show, in one call, so the page can show where a show
// heats up across all its tracks. `n` is the track's index in shows.json.
//   GET /api/shows/moments?show=<show id> -> { comments: [{ id, n, pos, nickname, body, created_at }], bucket: 5, counts: [[n, slice, count], ...] }
// Cached at the edge for a few seconds like /api/moments; a post clears the cached copy (functions/_moments.js).

import { SHOW_RE, json, showMomentsKey } from '../../_shared.js';
import { BUCKET } from '../../_moments.js';

const CACHE_SECONDS = 10;

export async function onRequestGet({ request, env, waitUntil }) {
  const show = new URL(request.url).searchParams.get('show') || '';
  if (!SHOW_RE.test(show)) return json({ error: 'Unknown show' }, 400);

  const cache = caches.default;
  const key = showMomentsKey(request, show);
  const hit = await cache.match(key);
  if (hit) return hit;

  // Every "<show>/<n>" sorts between "<show>/" and "<show>0" ('0' comes right after '/'), so this uses the track indexes.
  const lo = show + '/', hi = show + '0';
  const [comments, counts] = await env.DB.batch([
    env.DB.prepare('SELECT id, track, pos, nickname, body, created_at FROM comments WHERE track > ? AND track < ? AND hidden = 0 ORDER BY pos LIMIT 2000').bind(lo, hi),
    env.DB.prepare('SELECT track, bucket, COUNT(*) AS n FROM reactions WHERE track > ? AND track < ? GROUP BY track, bucket').bind(lo, hi),
  ]);
  const n = track => Number(track.slice(lo.length));
  const res = json({
    comments: comments.results.map(({ track, ...c }) => ({ ...c, n: n(track) })),
    bucket: BUCKET,
    counts: counts.results.map(r => [n(r.track), r.bucket, r.n]),
  });
  res.headers.set('Cache-Control', `public, max-age=${CACHE_SECONDS}`);
  waitUntil(cache.put(key, res.clone()));
  return res;
}
