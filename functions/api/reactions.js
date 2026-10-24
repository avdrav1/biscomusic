// Flame reactions, counted per 5-second slice of a track (one per listener per slice).
//   GET  /api/reactions?track=2026-09-01-02-jam1   -> { bucket: 5, counts: [[slice, n], ...] }
//   POST /api/reactions  { track, pos }             -> { counted }

import { TRACK_RE, json } from '../_shared.js';
import { postReaction, MOMENTS, BUCKET } from '../_moments.js';

export async function onRequestGet({ request, env }) {
  const track = new URL(request.url).searchParams.get('track') || '';
  if (!TRACK_RE.test(track)) return json({ error: 'Unknown track' }, 400);
  const { results } = await env.DB.prepare(
    'SELECT bucket, COUNT(*) AS n FROM reactions WHERE track = ? GROUP BY bucket'
  ).bind(track).all();
  return json({ bucket: BUCKET, counts: results.map(r => [r.bucket, r.n]) });
}

export const onRequestPost = context => postReaction(context, MOMENTS.jams);
