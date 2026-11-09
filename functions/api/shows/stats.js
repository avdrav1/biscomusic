// Show Radio's numbers for Up next and the request sheet, and its latest moments, cached for a minute.
//   GET /api/shows/stats -> { flames: { show: n }, talk: { show: n },
//     latest: [{ kind: 'comment', id, show, n, pos, nickname, body, at } | { kind: 'flame', show, n, pos, count, at }] }
// A show radio track is "<show>/<n>" (n: the track's index in shows.json); the jam radio's ids have no "/", so
// they're left out. latest: the newest comments and flamed moments, newest first.

import { json } from '../../_shared.js';
import { BUCKET } from '../../_moments.js';

const LATEST = 6;
const SHOW = "substr(track, 1, instr(track, '/') - 1)";

export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const key = new Request(new URL('/api/shows/stats', request.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;

  const [fire, talk, comments, flamed] = await env.DB.batch([
    env.DB.prepare(`SELECT ${SHOW} AS show, COUNT(*) AS n FROM reactions WHERE instr(track, '/') > 0 GROUP BY show`),
    env.DB.prepare(`SELECT ${SHOW} AS show, COUNT(*) AS n FROM comments WHERE hidden = 0 AND instr(track, '/') > 0 GROUP BY show`),
    env.DB.prepare("SELECT id, track, pos, nickname, body, created_at AS at FROM comments WHERE hidden = 0 AND instr(track, '/') > 0 ORDER BY created_at DESC LIMIT ?").bind(LATEST),
    env.DB.prepare("SELECT track, bucket, COUNT(*) AS n, MAX(created_at) AS at FROM reactions WHERE instr(track, '/') > 0 GROUP BY track, bucket ORDER BY at DESC LIMIT ?").bind(LATEST),
  ]);
  const split = track => { const k = track.lastIndexOf('/'); return { show: track.slice(0, k), n: Number(track.slice(k + 1)) }; };
  const latest = [
    ...comments.results.map(({ track, ...c }) => ({ kind: 'comment', ...split(track), ...c })),
    ...flamed.results.map(f => ({ kind: 'flame', ...split(f.track), pos: (f.bucket + 0.5) * BUCKET, count: f.n, at: f.at })),
  ].sort((a, b) => b.at - a.at).slice(0, LATEST);

  const res = json({
    latest,
    flames: Object.fromEntries(fire.results.map(r => [r.show, r.n])),
    talk: Object.fromEntries(talk.results.map(r => [r.show, r.n])),
  });
  res.headers.set('Cache-Control', 'public, max-age=60');
  waitUntil(cache.put(key, res.clone()));
  return res;
}
