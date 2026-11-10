// Per-track numbers for the request sheet's shortcuts and Up next, and the station's latest moments.
//   GET /api/catalog-stats -> { hot: { track: score }, flames: { track: n }, talk: { track: n }, last_played: { track: ms },
//                               latest: [{ kind: 'comment', id, track, pos, nickname, body, at } | { kind: 'flame', track, pos, n, at }] }
// hot = reactions + 2 x visible comments (the same weighting as /api/best). latest: the newest comments and flamed
// moments on the jam radio (Show Radio's tracks, "<show>/<n>", share the tables and are left out), newest first.
// The totals are cached for 5 minutes, Lately for 1.

import { json, edgeCached } from '../_shared.js';
import { BUCKET, latestComments, latestFlames } from '../_moments.js';

const LATEST = 6;
const JAMS = "instr(track, '/') = 0";
// Totals change slowly and read a row per track, so they're cached longer than Lately, which reads only the newest rows.
const TOTALS_SECONDS = 300, LATEST_SECONDS = 60;


async function totals(env) {
  const [fire, talk, plays] = await env.DB.batch([
    env.DB.prepare('SELECT track, COUNT(*) AS n FROM reactions GROUP BY track'),
    env.DB.prepare('SELECT track, COUNT(*) AS n FROM comments WHERE hidden = 0 GROUP BY track'),
    env.DB.prepare('SELECT track, at FROM last_played'),   // not MAX over plays: that read the whole history every call
  ]);
  const hot = {};
  fire.results.forEach(r => { hot[r.track] = (hot[r.track] || 0) + r.n; });
  talk.results.forEach(r => { hot[r.track] = (hot[r.track] || 0) + 2 * r.n; });
  return {
    hot,
    flames: Object.fromEntries(fire.results.map(r => [r.track, r.n])),
    talk: Object.fromEntries(talk.results.map(r => [r.track, r.n])),
    last_played: Object.fromEntries(plays.results.map(r => [r.track, r.at])),
  };
}

async function latest(env) {
  const [comments, flamed] = await env.DB.batch([latestComments(env, JAMS, LATEST), latestFlames(env, JAMS, LATEST)]);
  return [
    ...comments.results.map(c => ({ kind: 'comment', ...c })),
    ...flamed.results.map(f => ({ kind: 'flame', track: f.track, pos: (f.bucket + 0.5) * BUCKET, n: f.n, at: f.at })),
  ].sort((a, b) => b.at - a.at).slice(0, LATEST);
}

export async function onRequestGet({ request, env, waitUntil }) {
  const [t, l] = await Promise.all([
    edgeCached(request, waitUntil, '/api/catalog-stats/totals', TOTALS_SECONDS, () => totals(env)),
    edgeCached(request, waitUntil, '/api/catalog-stats/latest', LATEST_SECONDS, () => latest(env)),
  ]);
  const res = json({ ...t, latest: l });
  res.headers.set('Cache-Control', `public, max-age=${LATEST_SECONDS}`);
  return res;
}
