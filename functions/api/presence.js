// Live listener count. Players that are tuned in send a heartbeat every minute.
//   GET  /api/presence                      -> { listening }
//   POST /api/presence  { id, leaving? }    -> { listening }

import { json } from '../_shared.js';

const WINDOW = 90_000;   // a heartbeat is due every 60s; allow some slack
const ID_RE = /^[a-f0-9]{32}$/;

const count = async env =>
  (await env.DB.prepare('SELECT COUNT(*) AS n FROM presence WHERE seen > ?').bind(Date.now() - WINDOW).first()).n;

export async function onRequestGet({ env }) {
  return json({ listening: await count(env) });
}

export async function onRequestPost({ request, env }) {
  let input;
  try { input = JSON.parse(await request.text()); } catch { return json({ error: 'Bad request' }, 400); }
  const id = String(input.id || '');
  if (!ID_RE.test(id)) return json({ error: 'Bad request' }, 400);

  const now = Date.now();
  if (input.leaving) {
    await env.DB.prepare('DELETE FROM presence WHERE id = ?').bind(id).run();
  } else {
    await env.DB.prepare('INSERT INTO presence (id, seen) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET seen = excluded.seen')
      .bind(id, now).run();
    // Now and then, sweep out tabs that went away without saying goodbye.
    if (Math.random() < 0.02) await env.DB.prepare('DELETE FROM presence WHERE seen < ?').bind(now - 10 * 60_000).run();
  }
  return json({ listening: await count(env) });
}
