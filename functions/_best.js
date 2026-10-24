// Best moments, for both stations (BEST): 15-second windows ranked by reactions + comments (a comment counts double).
// The two stations share the comments and reactions tables; a show radio track has a "/" in it ("<show id>/<n>"),
// a jam radio track doesn't, so each station counts only its own.
//   GET /api/best        -> { moments: [{ track, pos, fire, comments, comment, song, jam, date, venue, city }] }
//   GET /api/shows/best  -> { moments: [{ track, pos, fire, comments, comment, show, n, title, date, venue, place, vault }] }
// Cached for a minute so the page doesn't rescan the tables on every visit.

import { json, trackIdOf } from './_shared.js';

export const WINDOW = 15;   // seconds (3 reaction slices)
const TOP = 25;

// path: the endpoint (its cache key); mine: the SQL test for this station's tracks;
// tracks: track id -> { duration, ...what the page shows } for every track on the air.
export const BEST = {
  jams: {
    path: '/api/best', mine: "track NOT LIKE '%/%'",
    async tracks(env, request) {
      const schedule = await env.ASSETS.fetch(new URL('/schedule.json', request.url)).then(r => r.json());
      return new Map(schedule.tracks.map(t => [trackIdOf(t), { duration: t.duration, song: t.song, jam: t.jam, date: t.date, venue: t.venue, city: t.city }]));
    },
  },
  shows: {
    path: '/api/shows/best', mine: "track LIKE '%/%'",
    async tracks(env, request) {
      const program = await env.ASSETS.fetch(new URL('/shows.json', request.url)).then(r => r.json());
      return showTracks(program);
    },
  },
};

export function showTracks(program) {
  const out = new Map();
  for (const s of program.shows) s.tracks.forEach((t, n) => out.set(`${s.show}/${n}`, {
    duration: t.duration, show: s.show, n, title: t.title || '', date: s.date, venue: s.venue, place: s.place, vault: !!s.vault,
  }));
  return out;
}

// fire: [{ track, w, n }] flames per window; talk: [{ track, w, n, first }] comments per window (first: the earliest
// comment's id). -> the TOP windows of tracks on the air, best first.
export function rank(fire, talk, tracks) {
  const byKey = new Map();
  const get = (track, w) => {
    const k = track + '|' + w;
    if (!byKey.has(k)) byKey.set(k, { track, w, fire: 0, comments: 0, first: null });
    return byKey.get(k);
  };
  fire.forEach(r => { get(r.track, r.w).fire = r.n; });
  talk.forEach(r => { const m = get(r.track, r.w); m.comments = r.n; m.first = r.first; });
  return [...byKey.values()]
    .filter(m => tracks.has(m.track))
    .sort((a, b) => (b.fire + 2 * b.comments) - (a.fire + 2 * a.comments) || b.comments - a.comments)
    .slice(0, TOP);
}

export async function bestMoments({ request, env, waitUntil }, cfg) {
  const cache = caches.default;
  const key = new Request(new URL(cfg.path, request.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;

  const [fire, talk] = await env.DB.batch([
    env.DB.prepare(`SELECT track, bucket / ${WINDOW / 5} AS w, COUNT(*) AS n FROM reactions WHERE ${cfg.mine} GROUP BY track, w`),
    env.DB.prepare(`SELECT track, CAST(pos / ${WINDOW} AS INTEGER) AS w, COUNT(*) AS n, MIN(id) AS first
                    FROM comments WHERE hidden = 0 AND ${cfg.mine} GROUP BY track, w`),
  ]);
  const tracks = await cfg.tracks(env, request);
  const top = rank(fire.results, talk.results, tracks);

  const ids = top.map(m => m.first).filter(Boolean);
  const comments = new Map();
  if (ids.length) {
    const { results } = await env.DB.prepare(
      `SELECT id, pos, nickname, body FROM comments WHERE id IN (${ids.map(() => '?').join(',')})`
    ).bind(...ids).all();
    results.forEach(c => comments.set(c.id, c));
  }

  const moments = top.map(m => {
    const { duration, ...t } = tracks.get(m.track);
    const comment = comments.get(m.first) || null;
    return {
      track: m.track,
      // The comment's exact moment when there is one, else the start of the window.
      pos: Math.floor(comment ? comment.pos : Math.min(m.w * WINDOW, duration)),
      fire: m.fire, comments: m.comments, comment, ...t,
    };
  });

  const res = json({ moments });
  res.headers.set('Cache-Control', 'public, max-age=60');
  waitUntil(cache.put(key, res.clone()));
  return res;
}
