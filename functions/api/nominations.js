// Nominations: upvote performances from the Nugs catalog to add to the station.
//   GET  /api/nominations                -> { votes: [[track, count], ...], mine: [track, ...] }
//   POST /api/nominations { track, on }  -> { track, votes, on }   (on: false takes the upvote back)
// One upvote per listener (IP hash) per performance; track ids come from site/nominees.json.

import { json, ipHash } from '../_shared.js';

const PER_HOUR = 60;    // new upvotes per listener per hour

// Track ids up for nomination, loaded once per isolate.
let known = null;
async function knownTracks(env, request) {
  if (!known) {
    const data = await env.ASSETS.fetch(new URL('/nominees.json', request.url)).then(r => r.json());
    known = new Set(data.tracks.map(t => t[0]));
  }
  return known;
}

export async function onRequestGet({ request, env }) {
  const voter = await ipHash(env, request);
  const [votes, mine] = await env.DB.batch([
    env.DB.prepare('SELECT track, COUNT(*) AS n FROM nominations GROUP BY track'),
    env.DB.prepare('SELECT track FROM nominations WHERE voter = ?').bind(voter),
  ]);
  return json({ votes: votes.results.map(r => [r.track, r.n]), mine: mine.results.map(r => r.track) });
}

export async function onRequestPost({ request, env }) {
  let input;
  try { input = await request.json(); } catch { return json({ error: 'Bad request' }, 400); }
  const track = input.track, on = input.on !== false;
  if (!Number.isSafeInteger(track) || track <= 0) return json({ error: 'Bad request' }, 400);
  if (!(await knownTracks(env, request)).has(track)) return json({ error: 'Unknown performance' }, 400);

  const voter = await ipHash(env, request), now = Date.now();
  if (on) {
    const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM nominations WHERE voter = ? AND created_at > ?')
      .bind(voter, now - 3600_000).first();
    if (recent.n >= PER_HOUR) return json({ error: 'That\'s a lot of upvotes. Take a breather and come back in a bit.' }, 429);
    await env.DB.prepare('INSERT OR IGNORE INTO nominations (track, voter, created_at) VALUES (?, ?, ?)')
      .bind(track, voter, now).run();
  } else {
    await env.DB.prepare('DELETE FROM nominations WHERE track = ? AND voter = ?').bind(track, voter).run();
  }
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM nominations WHERE track = ?').bind(track).first();
  return json({ track, votes: n, on });
}
