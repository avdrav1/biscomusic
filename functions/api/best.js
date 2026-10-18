// Best moments across the station: 15-second windows ranked by 🔥 + comments (a comment counts double).
//   GET /api/best -> { moments: [{ track, pos, fire, comments, comment, song, jam, date, venue, city }] }
// Cached for a minute so the page doesn't rescan the tables on every visit.

import { json } from '../_shared.js';

const WINDOW = 15;      // seconds (3 reaction slices)
const TOP = 25;

export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const key = new Request(new URL('/api/best', request.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;

  const [fire, talk] = await env.DB.batch([
    env.DB.prepare(`SELECT track, bucket / ${WINDOW / 5} AS w, COUNT(*) AS n FROM reactions GROUP BY track, w`),
    env.DB.prepare(`SELECT track, CAST(pos / ${WINDOW} AS INTEGER) AS w, COUNT(*) AS n, MIN(id) AS first
                    FROM comments WHERE hidden = 0 GROUP BY track, w`),
  ]);

  const byKey = new Map();
  const get = (track, w) => {
    const k = track + '|' + w;
    if (!byKey.has(k)) byKey.set(k, { track, w, fire: 0, comments: 0, first: null });
    return byKey.get(k);
  };
  fire.results.forEach(r => { get(r.track, r.w).fire = r.n; });
  talk.results.forEach(r => { const m = get(r.track, r.w); m.comments = r.n; m.first = r.first; });

  const schedule = await env.ASSETS.fetch(new URL('/schedule.json', request.url)).then(r => r.json());
  const tracks = new Map(schedule.tracks.map(t => [t.file.split('/').pop().replace(/\.mp3$/, ''), t]));

  const top = [...byKey.values()]
    .filter(m => tracks.has(m.track))
    .sort((a, b) => (b.fire + 2 * b.comments) - (a.fire + 2 * a.comments) || b.comments - a.comments)
    .slice(0, TOP);

  const ids = top.map(m => m.first).filter(Boolean);
  const comments = new Map();
  if (ids.length) {
    const { results } = await env.DB.prepare(
      `SELECT id, pos, nickname, body FROM comments WHERE id IN (${ids.map(() => '?').join(',')})`
    ).bind(...ids).all();
    results.forEach(c => comments.set(c.id, c));
  }

  const moments = top.map(m => {
    const t = tracks.get(m.track);
    const comment = comments.get(m.first) || null;
    return {
      track: m.track,
      // Link to the comment's exact moment when there is one, else the start of the window.
      pos: Math.floor(comment ? comment.pos : Math.min(m.w * WINDOW, t.duration)),
      fire: m.fire, comments: m.comments, comment,
      song: t.song, jam: t.jam, date: t.date, venue: t.venue, city: t.city,
    };
  });

  const res = json({ moments });
  res.headers.set('Cache-Control', 'public, max-age=60');
  waitUntil(cache.put(key, res.clone()));
  return res;
}
