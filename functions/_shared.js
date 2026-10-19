// Helpers shared by the API routes (files starting with _ aren't routes).

export const TRACK_RE = /^\d{4}-\d{2}-\d{2}-\d{2}(-jam\d+)?$/;

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

// The edge-cache key for /api/moments of a track (comments.js and reactions.js clear it on a post).
export const momentsKey = (request, track) =>
  new Request(new URL('/api/moments?track=' + encodeURIComponent(track), request.url).toString());

// A schedule entry's track id: the mp3 name without .mp3 (or the ?v=<hash> on R2 URLs).
export const trackIdOf = t => t.file.split('/').pop().split('?')[0].replace(/\.mp3$/, '');

// The schedule entry for a track id, or undefined if it isn't on the air.
export async function findTrack(env, request, track) {
  const schedule = await env.ASSETS.fetch(new URL('/schedule.json', request.url)).then(r => r.json());
  return schedule.tracks.find(t => trackIdOf(t) === track);
}

// A visible comment by id, or null.
export async function getComment(env, id) {
  if (!/^\d{1,12}$/.test(String(id))) return null;
  return env.DB.prepare('SELECT id, track, pos, nickname, body, created_at FROM comments WHERE id = ? AND hidden = 0')
    .bind(Number(id)).first();
}

// "2026-09-26-04-jam2@312" -> { track, pos }, or null.
export function parseMoment(m) {
  const match = /^(\d{4}-\d{2}-\d{2}-\d{2}(?:-jam\d+)?)@(\d{1,5})$/.exec(String(m || ''));
  return match && { track: match[1], pos: Number(match[2]) };
}

export const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export async function ipHash(env, request) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.IP_SALT + ip));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
