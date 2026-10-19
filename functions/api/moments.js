// Everything the timeline shows for a track, in one call: its comments and its flame counts.
//   GET /api/moments?track=2026-09-01-02-jam1 -> { comments: [...], bucket: 5, counts: [[slice, n], ...] }
// Every listener polls this, so it's cached at the edge for a few seconds; posting a comment or
// a flame clears the cached copy (in the poster's data center) so their own shows up right away.

import { TRACK_RE, json, momentsKey } from '../_shared.js';

const CACHE_SECONDS = 10;
const BUCKET = 5;   // seconds per flame slice, as in reactions.js

export async function onRequestGet({ request, env, waitUntil }) {
  const track = new URL(request.url).searchParams.get('track') || '';
  if (!TRACK_RE.test(track)) return json({ error: 'Unknown track' }, 400);

  const cache = caches.default;
  const key = momentsKey(request, track);
  const hit = await cache.match(key);
  if (hit) return hit;

  const [comments, counts] = await env.DB.batch([
    env.DB.prepare('SELECT id, pos, nickname, body, created_at FROM comments WHERE track = ? AND hidden = 0 ORDER BY pos LIMIT 500').bind(track),
    env.DB.prepare('SELECT bucket, COUNT(*) AS n FROM reactions WHERE track = ? GROUP BY bucket').bind(track),
  ]);
  const res = json({ comments: comments.results, bucket: BUCKET, counts: counts.results.map(r => [r.bucket, r.n]) });
  res.headers.set('Cache-Control', `public, max-age=${CACHE_SECONDS}`);
  waitUntil(cache.put(key, res.clone()));
  return res;
}
