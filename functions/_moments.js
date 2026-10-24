// Comments and flame reactions pinned to a moment of a track, for both stations (MOMENTS). They share the
// comments and reactions tables: a jam radio track is a jam id ("2026-09-01-02-jam1"), a show radio track is
// "<show id>/<track index>" (shows.json), so the two never collide.
//   POST <path>/comments  { track, pos, nickname?, body, token }  -> { comment }
//   POST <path>/reactions { track, pos }                          -> { counted }
// (functions/api/ for the jam radio, functions/api/shows/ for the show radio)

import { TRACK_RE, SHOW_TRACK_RE, json, findTrack, findShowTrack, ipHash, momentsKey, showMomentsKey } from './_shared.js';

// id: a valid track; find: its entry ({ duration }) if it's on the air; cacheKey: the cached moments to clear on a post.
export const MOMENTS = {
  jams: { id: TRACK_RE, find: findTrack, cacheKey: momentsKey },
  shows: { id: SHOW_TRACK_RE, find: findShowTrack, cacheKey: (request, track) => showMomentsKey(request, track.split('/')[0]) },
};

export const BUCKET = 5;   // seconds per flame slice: one flame per listener per slice, so counts mean "people"

const MAX_BODY = 280;
const MAX_NICK = 24;
const COMMENTS_PER_MINUTE = 5;
const COMMENTS_PER_HOUR = 30;
const FLAMES_PER_MINUTE = 20;

export async function postComment({ request, env, waitUntil }, cfg) {
  let input;
  try { input = await request.json(); } catch { return json({ error: 'Bad request' }, 400); }

  const track = String(input.track || '');
  const pos = Number(input.pos);
  const nickname = clean(input.nickname).slice(0, MAX_NICK) || null;
  const body = clean(input.body);

  if (!cfg.id.test(track) || !Number.isFinite(pos) || pos < 0) return json({ error: 'Bad request' }, 400);
  if (!body) return json({ error: 'Say something first' }, 400);
  if (body.length > MAX_BODY) return json({ error: `Keep it under ${MAX_BODY} characters` }, 400);
  if (/https?:\/\/|www\./i.test(body + ' ' + (nickname || ''))) return json({ error: 'Links aren\'t allowed' }, 400);
  if (blocked(body + ' ' + (nickname || ''), env.BLOCKED_WORDS)) return json({ error: 'That comment can\'t be posted' }, 400);

  // The track must be on the air, and the moment inside it.
  const t = await cfg.find(env, request, track);
  if (!t || pos > t.duration) return json({ error: 'Unknown track' }, 400);

  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!(await turnstileOk(env, input.token, ip))) return json({ error: 'Couldn\'t verify you\'re human. Try again.' }, 403);

  // Rate limits count comments on both stations together.
  const author = await ipHash(env, request);
  const now = Date.now();
  const recent = await env.DB.prepare(
    'SELECT SUM(created_at > ?) AS minute, COUNT(*) AS hour FROM comments WHERE ip_hash = ? AND created_at > ?'
  ).bind(now - 60_000, author, now - 3_600_000).first();
  if (recent.minute >= COMMENTS_PER_MINUTE || recent.hour >= COMMENTS_PER_HOUR) return json({ error: 'Slow down a little' }, 429);

  const row = await env.DB.prepare(
    'INSERT INTO comments (track, pos, nickname, body, created_at, ip_hash) VALUES (?, ?, ?, ?, ?, ?) RETURNING id, pos, nickname, body, created_at'
  ).bind(track, Math.round(pos * 10) / 10, nickname, body, now, author).first();
  waitUntil(caches.default.delete(cfg.cacheKey(request, track)));
  return json({ comment: row }, 201);
}

export async function postReaction({ request, env, waitUntil }, cfg) {
  let input;
  try { input = await request.json(); } catch { return json({ error: 'Bad request' }, 400); }
  const track = String(input.track || '');
  const pos = Number(input.pos);
  if (!cfg.id.test(track) || !Number.isFinite(pos) || pos < 0) return json({ error: 'Bad request' }, 400);

  const t = await cfg.find(env, request, track);
  if (!t || pos > t.duration) return json({ error: 'Unknown track' }, 400);

  const who = await ipHash(env, request);
  const now = Date.now();
  const recent = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM reactions WHERE ip_hash = ? AND created_at > ?'
  ).bind(who, now - 60_000).first();
  if (recent.n >= FLAMES_PER_MINUTE) return json({ error: 'Slow down a little' }, 429);

  const r = await env.DB.prepare(
    'INSERT OR IGNORE INTO reactions (track, bucket, ip_hash, created_at) VALUES (?, ?, ?, ?)'
  ).bind(track, Math.floor(pos / BUCKET), who, now).run();
  if (r.meta.changes) waitUntil(caches.default.delete(cfg.cacheKey(request, track)));
  return json({ counted: r.meta.changes > 0 });
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
