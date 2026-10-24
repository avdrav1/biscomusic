// Live listener count of one station ('jams' or 'shows'). Players that are tuned in send a heartbeat every minute
// with a random per-tab id (no IP); a tab counts while its last heartbeat is under WINDOW old.
//   GET  <station path>/presence                    -> { listening }
//   POST <station path>/presence  { id, leaving? }  -> { listening }
// (functions/api/presence.js for the jam radio, functions/api/shows/presence.js for the show radio)

import { json } from './_shared.js';

const WINDOW = 90_000;   // a heartbeat is due every 60s; allow some slack
const ID_RE = /^[a-f0-9]{32}$/;

const count = async (env, station) =>
  (await env.DB.prepare('SELECT COUNT(*) AS n FROM presence WHERE station = ? AND seen > ?').bind(station, Date.now() - WINDOW).first()).n;

export async function presenceGet({ env }, station) {
  return json({ listening: await count(env, station) });
}

export async function presencePost({ request, env }, station) {
  let input;
  try { input = JSON.parse(await request.text()); } catch { return json({ error: 'Bad request' }, 400); }   // sendBeacon posts text
  const id = String(input.id || '');
  if (!ID_RE.test(id)) return json({ error: 'Bad request' }, 400);

  const now = Date.now();
  if (input.leaving) {
    await env.DB.prepare('DELETE FROM presence WHERE id = ?').bind(id).run();
  } else {
    await env.DB.prepare('INSERT INTO presence (id, seen, station) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET seen = excluded.seen, station = excluded.station')
      .bind(id, now, station).run();
    // Now and then, sweep out tabs that went away without saying goodbye.
    if (Math.random() < 0.02) await env.DB.prepare('DELETE FROM presence WHERE seen < ?').bind(now - 10 * 60_000).run();
  }
  return json({ listening: await count(env, station) });
}
