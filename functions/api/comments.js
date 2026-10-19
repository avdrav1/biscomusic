// Comments pinned to a moment in a track.
//   GET  /api/comments?track=2026-09-01-02-jam1   -> { comments: [...] }
//   GET  /api/comments?id=42                      -> { comment }  (for shared links)
//   POST /api/comments  { track, pos, nickname?, body, token }

import { TRACK_RE, json, findTrack, ipHash, getComment, momentsKey } from '../_shared.js';

const MAX_BODY = 280;
const MAX_NICK = 24;
const PER_MINUTE = 5;
const PER_HOUR = 30;

export async function onRequestGet({ request, env }) {
  const params = new URL(request.url).searchParams;
  if (params.has('id')) {
    const comment = await getComment(env, params.get('id'));
    return comment ? json({ comment }) : json({ error: 'Not found' }, 404);
  }
  const track = params.get('track') || '';
  if (!TRACK_RE.test(track)) return json({ error: 'Unknown track' }, 400);
  const { results } = await env.DB.prepare(
    'SELECT id, pos, nickname, body, created_at FROM comments WHERE track = ? AND hidden = 0 ORDER BY pos LIMIT 500'
  ).bind(track).all();
  return json({ comments: results });
}

export async function onRequestPost({ request, env, waitUntil }) {
  let input;
  try { input = await request.json(); } catch { return json({ error: 'Bad request' }, 400); }

  const track = String(input.track || '');
  const pos = Number(input.pos);
  const nickname = clean(input.nickname).slice(0, MAX_NICK) || null;
  const body = clean(input.body);

  if (!TRACK_RE.test(track) || !Number.isFinite(pos) || pos < 0) return json({ error: 'Bad request' }, 400);
  if (!body) return json({ error: 'Say something first' }, 400);
  if (body.length > MAX_BODY) return json({ error: `Keep it under ${MAX_BODY} characters` }, 400);
  if (/https?:\/\/|www\./i.test(body + ' ' + (nickname || ''))) return json({ error: 'Links aren\'t allowed' }, 400);
  if (blocked(body + ' ' + (nickname || ''), env.BLOCKED_WORDS)) return json({ error: 'That comment can\'t be posted' }, 400);

  // The track must be on the air, and the moment inside it.
  const t = await findTrack(env, request, track);
  if (!t || pos > t.duration) return json({ error: 'Unknown track' }, 400);

  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!(await turnstileOk(env, input.token, ip))) return json({ error: 'Couldn\'t verify you\'re human. Try again.' }, 403);

  const author = await ipHash(env, request);
  const now = Date.now();
  const recent = await env.DB.prepare(
    'SELECT SUM(created_at > ?) AS minute, COUNT(*) AS hour FROM comments WHERE ip_hash = ? AND created_at > ?'
  ).bind(now - 60_000, author, now - 3_600_000).first();
  if (recent.minute >= PER_MINUTE || recent.hour >= PER_HOUR) return json({ error: 'Slow down a little' }, 429);

  const row = await env.DB.prepare(
    'INSERT INTO comments (track, pos, nickname, body, created_at, ip_hash) VALUES (?, ?, ?, ?, ?, ?) RETURNING id, pos, nickname, body, created_at'
  ).bind(track, Math.round(pos * 10) / 10, nickname, body, now, author).first();
  waitUntil(caches.default.delete(momentsKey(request, track)));
  return json({ comment: row }, 201);
}

function clean(s) {
  return String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

function blocked(text, list) {
  const words = String(list || '').split(',').map(w => w.trim().toLowerCase()).filter(Boolean);
  const lower = text.toLowerCase();
  return words.some(w => lower.includes(w));
}

async function turnstileOk(env, token, ip) {
  if (!token) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  return (await r.json()).success === true;
}
