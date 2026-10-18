// 🔥 reactions, counted per 5-second slice of a track (one per listener per slice).
//   GET  /api/reactions?track=2026-09-01-02-jam1   -> { bucket: 5, counts: [[slice, n], ...] }
//   POST /api/reactions  { track, pos }             -> { counted }

import { TRACK_RE, json, findTrack, ipHash } from '../_shared.js';

const BUCKET = 5;
const PER_MINUTE = 20;

export async function onRequestGet({ request, env }) {
  const track = new URL(request.url).searchParams.get('track') || '';
  if (!TRACK_RE.test(track)) return json({ error: 'Unknown track' }, 400);
  const { results } = await env.DB.prepare(
    'SELECT bucket, COUNT(*) AS n FROM reactions WHERE track = ? GROUP BY bucket'
  ).bind(track).all();
  return json({ bucket: BUCKET, counts: results.map(r => [r.bucket, r.n]) });
}

export async function onRequestPost({ request, env }) {
  let input;
  try { input = await request.json(); } catch { return json({ error: 'Bad request' }, 400); }
  const track = String(input.track || '');
  const pos = Number(input.pos);
  if (!TRACK_RE.test(track) || !Number.isFinite(pos) || pos < 0) return json({ error: 'Bad request' }, 400);

  const t = await findTrack(env, request, track);
  if (!t || pos > t.duration) return json({ error: 'Unknown track' }, 400);

  const who = await ipHash(env, request);
  const now = Date.now();
  const recent = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM reactions WHERE ip_hash = ? AND created_at > ?'
  ).bind(who, now - 60_000).first();
  if (recent.n >= PER_MINUTE) return json({ error: 'Slow down a little' }, 429);

  const r = await env.DB.prepare(
    'INSERT OR IGNORE INTO reactions (track, bucket, ip_hash, created_at) VALUES (?, ?, ?, ?)'
  ).bind(track, Math.floor(pos / BUCKET), who, now).run();
  return json({ counted: r.meta.changes > 0 });
}
