// Vote for the next track. One vote per listener (IP hash) per round; voting again moves it.
//   POST /api/vote { round, track } -> view() with the fresh tally

import { TRACK_RE, json, ipHash } from '../_shared.js';
import { getStation, eligible, view } from '../_station.js';

export async function onRequestPost({ request, env }) {
  let input;
  try { input = await request.json(); } catch { return json({ error: 'Bad request' }, 400); }
  const track = String(input.track || ''), round = Number(input.round);
  if (!TRACK_RE.test(track) || !Number.isInteger(round)) return json({ error: 'Bad request' }, 400);

  const now = Date.now();
  const { state, catalog, recent } = await getStation(env, request, now);
  if (round !== state.round) return json({ error: 'That round is over. Vote for the next one!' }, 409);
  const v = view(state, catalog, [], recent, now);
  if (!v.voting_open) return json({ error: 'Voting for this slot just closed' }, 409);
  if (!catalog.some(t => t.id === track)) return json({ error: 'Unknown track' }, 400);
  if (!eligible(catalog, recent).includes(track)) return json({ error: 'That one played recently. Pick another!' }, 400);

  // One row per listener per round, so there's nothing to spam: voting again just moves it.
  const voter = await ipHash(env, request);
  // Keep the original time when re-voting for the same track (it's the tie-break); a new pick restarts it.
  await env.DB.prepare(
    `INSERT INTO votes (round, voter, track, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (round, voter) DO UPDATE SET track = excluded.track, created_at = excluded.created_at
     WHERE votes.track != excluded.track`
  ).bind(round, voter, track, now).run();

  const votes = await env.DB.prepare('SELECT track, created_at FROM votes WHERE round = ?').bind(round).all();
  return json({ ...view(state, catalog, votes.results, recent, now), my_vote: track });
}
