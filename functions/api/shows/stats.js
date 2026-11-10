// Show Radio's numbers for Up next and the request sheet (cached for 5 minutes), and its latest moments (for 1).
//   GET /api/shows/stats -> { flames: { show: n }, talk: { show: n },
//     latest: [{ kind: 'comment', id, show, n, pos, nickname, body, at } | { kind: 'flame', show, n, pos, count, at }] }
// A show radio track is "<show>/<n>" (n: the track's index in shows.json); the jam radio's ids have no "/", so
// they're left out. latest: the newest comments and flamed moments, newest first.

import { json, edgeCached } from '../../_shared.js';
import { BUCKET, latestComments, latestFlames } from '../../_moments.js';

const LATEST = 6;
const SHOWS = "instr(track, '/') > 0";
const SHOW = "substr(track, 1, instr(track, '/') - 1)";
// Totals change slowly and read a row per flame, so they're cached longer than Lately, which reads only the newest rows.
const TOTALS_SECONDS = 300, LATEST_SECONDS = 60;


async function totals(env) {
  const [fire, talk] = await env.DB.batch([
    env.DB.prepare(`SELECT ${SHOW} AS show, COUNT(*) AS n FROM reactions WHERE ${SHOWS} GROUP BY show`),
    env.DB.prepare(`SELECT ${SHOW} AS show, COUNT(*) AS n FROM comments WHERE hidden = 0 AND ${SHOWS} GROUP BY show`),
  ]);
  return {
    flames: Object.fromEntries(fire.results.map(r => [r.show, r.n])),
    talk: Object.fromEntries(talk.results.map(r => [r.show, r.n])),
  };
}

async function latest(env) {
  const [comments, flamed] = await env.DB.batch([latestComments(env, SHOWS, LATEST), latestFlames(env, SHOWS, LATEST)]);
  const split = track => { const k = track.lastIndexOf('/'); return { show: track.slice(0, k), n: Number(track.slice(k + 1)) }; };
  return [
    ...comments.results.map(({ track, ...c }) => ({ kind: 'comment', ...split(track), ...c })),
    ...flamed.results.map(f => ({ kind: 'flame', ...split(f.track), pos: (f.bucket + 0.5) * BUCKET, count: f.n, at: f.at })),
  ].sort((a, b) => b.at - a.at).slice(0, LATEST);
}

export async function onRequestGet({ request, env, waitUntil }) {
  const [t, l] = await Promise.all([
    edgeCached(request, waitUntil, '/api/shows/stats/totals', TOTALS_SECONDS, () => totals(env)),
    edgeCached(request, waitUntil, '/api/shows/stats/latest', LATEST_SECONDS, () => latest(env)),
  ]);
  const res = json({ latest: l, ...t });
  res.headers.set('Cache-Control', `public, max-age=${LATEST_SECONDS}`);
  return res;
}
