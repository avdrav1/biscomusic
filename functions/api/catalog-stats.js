// Per-track numbers for the request sheet's shortcuts and Up next, and the station's latest moments, cached for a minute.
//   GET /api/catalog-stats -> { hot: { track: score }, flames: { track: n }, talk: { track: n }, last_played: { track: ms },
//                               latest: [{ kind: 'comment', id, track, pos, nickname, body, at } | { kind: 'flame', track, pos, n, at }] }
// hot = reactions + 2 x visible comments (the same weighting as /api/best). latest: the newest comments and flamed
// moments on the jam radio (Show Radio's tracks, "<show>/<n>", share the tables and are left out), newest first.

import { json } from '../_shared.js';
import { BUCKET } from '../_moments.js';

const LATEST = 6;

export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const key = new Request(new URL('/api/catalog-stats', request.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;

  const [fire, talk, plays, comments, flamed] = await env.DB.batch([
    env.DB.prepare('SELECT track, COUNT(*) AS n FROM reactions GROUP BY track'),
    env.DB.prepare('SELECT track, COUNT(*) AS n FROM comments WHERE hidden = 0 GROUP BY track'),
    env.DB.prepare('SELECT track, MAX(started_at) AS at FROM plays GROUP BY track'),
    env.DB.prepare("SELECT id, track, pos, nickname, body, created_at AS at FROM comments WHERE hidden = 0 AND instr(track, '/') = 0 ORDER BY created_at DESC LIMIT ?").bind(LATEST),
    env.DB.prepare("SELECT track, bucket, COUNT(*) AS n, MAX(created_at) AS at FROM reactions WHERE instr(track, '/') = 0 GROUP BY track, bucket ORDER BY at DESC LIMIT ?").bind(LATEST),
  ]);
  const hot = {};
  fire.results.forEach(r => { hot[r.track] = (hot[r.track] || 0) + r.n; });
  talk.results.forEach(r => { hot[r.track] = (hot[r.track] || 0) + 2 * r.n; });
  const latest = [
    ...comments.results.map(c => ({ kind: 'comment', ...c })),
    ...flamed.results.map(f => ({ kind: 'flame', track: f.track, pos: (f.bucket + 0.5) * BUCKET, n: f.n, at: f.at })),
  ].sort((a, b) => b.at - a.at).slice(0, LATEST);

  const res = json({
    hot, latest,
    flames: Object.fromEntries(fire.results.map(r => [r.track, r.n])),
    talk: Object.fromEntries(talk.results.map(r => [r.track, r.n])),
    last_played: Object.fromEntries(plays.results.map(r => [r.track, r.at])),
  });
  res.headers.set('Cache-Control', 'public, max-age=60');
  waitUntil(cache.put(key, res.clone()));
  return res;
}
