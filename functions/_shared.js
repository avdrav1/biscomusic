// Helpers shared by the API routes (files starting with _ aren't routes).

export const TRACK_RE = /^\d{4}-\d{2}-\d{2}-\d{2}(-jam\d+)?$/;

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

// The schedule entry for a track id (mp3 name without .mp3), or undefined if it isn't on the air.
export async function findTrack(env, request, track) {
  const schedule = await env.ASSETS.fetch(new URL('/schedule.json', request.url)).then(r => r.json());
  return schedule.tracks.find(t => t.file.split('/').pop() === track + '.mp3');
}

export async function ipHash(env, request) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.IP_SALT + ip));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
