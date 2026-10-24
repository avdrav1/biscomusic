// What's on air, decided by listener votes, falling back to the catalog rotation.
//
// There's no server process: every station request runs advance(), which locks in the next
// item once voting closes (LOCK_MS before the end) and moves to it once the current one ends,
// fast-forwarding through any idle stretch. Writes use optimistic concurrency (version column).
//
// Two stations run on this code (STATIONS): the jam radio, where an item is one jam of schedule.json,
// and the show radio, where an item is one whole show of shows.json. Each has its own D1 tables.
// The code says "track" for an item throughout, as the tables do.

import { TRACK_RE, SHOW_RE, trackIdOf, json, ipHash } from './_shared.js';

export const LOCK_MS = 45_000;     // voting closes this long before the end (the player preloads then)
export const RECENT = 5;           // the current track and the N before it can't be voted for or rotated back in

// Catalog in rotation order: [{ id, duration }] (seconds), from schedule.json.
export const catalogOf = schedule => schedule.tracks.map(t => ({ id: trackIdOf(t), duration: t.duration }));
// The show radio's catalog: every show of shows.json, oldest first, as long as its tracks together. Vault shows
// (matrix and audience tapes, shows.py) play only when voted for: the rotation and the clock skip them.
export const showCatalogOf = program => program.shows.map(s => ({ id: s.show, duration: s.tracks.reduce((n, t) => n + t.duration, 0), ...(s.vault && { vault: true }) }));

// path: the station's API (its view is cached at the edge under path + '/station'); source: its catalog file.
export const STATIONS = {
  jams: { path: '/api', source: '/schedule.json', catalogOf, station: 'station', votes: 'votes', plays: 'plays', id: TRACK_RE },
  shows: { path: '/api/shows', source: '/shows-api.json', catalogOf: showCatalogOf, station: 'show_station', votes: 'show_votes',
           plays: 'show_plays', id: SHOW_RE },
};

// Where the old clock-only station would be right now, so switching to voting doesn't jump. The clock runs over the
// rotation only (no vault shows), as the player's does without the station.
export function seedFromClock(schedule, catalog, now) {
  const rot = catalog.filter(t => !t.vault), total = rot.reduce((s, t) => s + t.duration, 0);
  let pos = ((now - Date.parse(schedule.epoch)) / 1000) % total;
  let k = 0;
  while (pos >= rot[k].duration) { pos -= rot[k].duration; k++; }
  const i = indexOf(catalog, rot[k].id);
  return {
    version: 0, round: 1, track: catalog[i].id, started_at: Math.round(now - pos * 1000), cursor: i, cursor_track: catalog[i].id,
    next_track: null, next_source: null, next_votes: null, next_cursor: null, next_cursor_track: null,
  };
}

const indexOf = (catalog, id) => catalog.findIndex(t => t.id === id);

// The rotation's place, by track id when we have it (indexes shift when older shows are added).
// If that track left the catalog, fall back to the stored index.
function place(catalog, id, index) {
  const i = id != null ? indexOf(catalog, id) : -1;
  return i >= 0 ? i : Math.min(Math.max(index ?? 0, 0), catalog.length - 1);
}

// Who can be picked next: not the current track or the last RECENT played (unless that leaves nothing).
export function eligible(catalog, recent) {
  const blocked = new Set(recent.slice(0, RECENT + 1));
  const ok = catalog.filter(t => !blocked.has(t.id)).map(t => t.id);
  return ok.length ? ok : catalog.map(t => t.id).filter(id => id !== recent[0]);
}

// Tally votes for one round: [[track, count, firstVoteAt]], best first.
export function tally(votes, allowed, catalog, cursor) {
  const ok = new Set(allowed), by = new Map();
  for (const v of votes) {
    if (!ok.has(v.track)) continue;
    const t = by.get(v.track) || { n: 0, first: Infinity };
    t.n++; t.first = Math.min(t.first, v.created_at);
    by.set(v.track, t);
  }
  const n = catalog.length, dist = id => (indexOf(catalog, id) - cursor + n) % n || n;
  return [...by.entries()]
    .sort(([a, x], [b, y]) => y.n - x.n || x.first - y.first || dist(a) - dist(b))
    .map(([track, t]) => [track, t.n, t.first]);
}

// The rotation's next pick after `cursor`, skipping anything played recently (or already chosen) and the vault.
export function rotationNext(catalog, cursor, recent, skip = []) {
  const ok = new Set(eligible(catalog, recent)), n = catalog.length;
  for (const s of skip) ok.delete(s);
  for (let k = 1; k <= n; k++) {
    const i = (cursor + k) % n;
    if (ok.has(catalog[i].id) && !catalog[i].vault) return i;
  }
  for (let k = 1; k <= n; k++) if (!catalog[(cursor + k) % n].vault) return (cursor + k) % n;
  return (cursor + 1) % n;
}

// The next few rotation picks after the locked/expected next one (for "Coming up").
export function rotationPreview(state, catalog, recent, count = 5) {
  const out = [], seen = [...recent];
  let cursor = state.next_track != null ? place(catalog, state.next_cursor_track, state.next_cursor) : place(catalog, state.cursor_track, state.cursor);
  if (state.next_track != null) seen.unshift(state.next_track);
  for (let k = 0; k < count; k++) {
    const i = rotationNext(catalog, cursor, seen);
    out.push(catalog[i].id); seen.unshift(catalog[i].id); cursor = i;
  }
  return out;
}

// Pure state transition. `votes` are this round's votes ([{ track, created_at }]); `recent` is the
// newest-first list of tracks played (recent[0] is the current track). Returns the new state, the
// plays to record, and the updated recent list.
export function advance(state, catalog, votes, recent, now) {
  const s = { ...state }, plays = [];
  s.cursor = place(catalog, s.cursor_track, s.cursor);
  s.cursor_track = catalog[s.cursor].id;
  if (s.next_track != null) { s.next_cursor = place(catalog, s.next_cursor_track, s.next_cursor); s.next_cursor_track = catalog[s.next_cursor].id; }
  recent = [...recent];
  let roundVotes = votes;
  for (let guard = 0; guard < 100_000; guard++) {
    const cur = catalog[indexOf(catalog, s.track)];
    const end = s.started_at + (cur ? cur.duration * 1000 : 0);   // a track removed from the catalog ends at once

    if (s.next_track == null && now >= end - LOCK_MS) {
      const allowed = eligible(catalog, recent);
      const [top] = tally(roundVotes, allowed, catalog, s.cursor);
      if (top) Object.assign(s, { next_track: top[0], next_source: 'vote', next_votes: top[1], next_cursor: s.cursor, next_cursor_track: s.cursor_track });
      else {
        const i = rotationNext(catalog, s.cursor, recent);
        Object.assign(s, { next_track: catalog[i].id, next_source: 'rotation', next_votes: 0, next_cursor: i, next_cursor_track: catalog[i].id });
      }
    }
    if (now < end) break;

    plays.push({ round: s.round + 1, track: s.next_track, started_at: end, source: s.next_source, votes: s.next_votes });
    recent.unshift(s.next_track);
    Object.assign(s, { round: s.round + 1, track: s.next_track, started_at: end, cursor: s.next_cursor, cursor_track: s.next_cursor_track,
                       next_track: null, next_source: null, next_votes: null, next_cursor: null, next_cursor_track: null });
    roundVotes = [];   // nobody could vote for rounds that hadn't started
  }
  const moved = s.cursor !== state.cursor || s.cursor_track !== state.cursor_track;   // e.g. the catalog grew
  return { state: s, plays: plays.slice(-RECENT * 2), recent: recent.slice(0, RECENT * 2), changed: plays.length > 0 || s.next_track !== state.next_track || moved };
}

// Public view of the state for the player.
export function view(state, catalog, votes, recent, now) {
  const cur = catalog[indexOf(catalog, state.track)];
  const end = state.started_at + (cur ? cur.duration * 1000 : 0);
  const allowed = eligible(catalog, recent);
  return {
    server_now: now,
    round: state.round,
    track: state.track,
    started_at: state.started_at,
    end_at: end,
    lock_at: end - LOCK_MS,
    voting_open: state.next_track == null && now < end - LOCK_MS,
    next: state.next_track == null ? null : { track: state.next_track, source: state.next_source, votes: state.next_votes },
    tally: tally(votes, allowed, catalog, state.cursor).map(([t, n]) => [t, n]),
    recent: recent.slice(0, RECENT + 1),
    rotation: rotationPreview(state, catalog, recent),
  };
}

// ---- D1 ----

const COLS = 'version, round, track, started_at, cursor, next_track, next_source, next_votes, next_cursor, cursor_track, next_cursor_track';

async function load(env, cfg) {
  const [st, rec] = await env.DB.batch([
    env.DB.prepare(`SELECT ${COLS} FROM ${cfg.station} WHERE id = 1`),
    env.DB.prepare(`SELECT track FROM ${cfg.plays} ORDER BY round DESC LIMIT ${RECENT * 2}`),
  ]);
  return { state: st.results[0] || null, recent: rec.results.map(r => r.track) };
}

const roundVotes = (env, cfg, round) =>
  env.DB.prepare(`SELECT track, created_at FROM ${cfg.votes} WHERE round = ?`).bind(round).all().then(r => r.results);

async function source(env, request, cfg) {
  return env.ASSETS.fetch(new URL(cfg.source, request.url)).then(r => r.json());
}

// Current state of one station (STATIONS.jams by default), advanced to `now` and saved, plus everything the player needs.
export async function getStation(env, request, now = Date.now(), cfg = STATIONS.jams) {
  const sched = await source(env, request, cfg), catalog = cfg.catalogOf(sched);
  for (let attempt = 0; attempt < 4; attempt++) {
    let { state, recent } = await load(env, cfg);
    if (!state) {
      const seed = seedFromClock(sched, catalog, now);
      const r = await env.DB.prepare(`INSERT OR IGNORE INTO ${cfg.station} (id, ${COLS}) VALUES (1, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, NULL)`)
        .bind(seed.version, seed.round, seed.track, seed.started_at, seed.cursor, seed.cursor_track).run();
      if (r.meta.changes) await env.DB.prepare(`INSERT OR IGNORE INTO ${cfg.plays} (round, track, started_at, source) VALUES (?, ?, ?, 'seed')`)
        .bind(seed.round, seed.track, seed.started_at).run();
      continue;   // re-read whichever seed won
    }
    const votes = await roundVotes(env, cfg, state.round);
    const out = advance(state, catalog, votes, recent, now);
    if (out.changed) {
      const s = out.state;
      const w = await env.DB.prepare(
        `UPDATE ${cfg.station} SET version = version + 1, round = ?, track = ?, started_at = ?, cursor = ?, cursor_track = ?,
           next_track = ?, next_source = ?, next_votes = ?, next_cursor = ?, next_cursor_track = ? WHERE id = 1 AND version = ?`
      ).bind(s.round, s.track, s.started_at, s.cursor, s.cursor_track, s.next_track, s.next_source, s.next_votes, s.next_cursor,
             s.next_cursor_track, state.version).run();
      if (!w.meta.changes) continue;   // someone else advanced it first; start over from their state
      if (out.plays.length) await env.DB.batch(out.plays.map(p =>
        env.DB.prepare(`INSERT OR IGNORE INTO ${cfg.plays} (round, track, started_at, source, votes) VALUES (?, ?, ?, ?, ?)`)
          .bind(p.round, p.track, p.started_at, p.source, p.votes)));
      s.version = state.version + 1;
      const fresh = s.round === state.round ? votes : [];
      return { state: s, catalog, recent: out.recent, votes: fresh, view: view(s, catalog, fresh, out.recent, now) };
    }
    return { state, catalog, recent, votes, view: view(state, catalog, votes, recent, now) };
  }
  throw new Error('station is busy');
}

// ---- The API routes (functions/api/station.js and vote.js, and their shows/ twins) ----

const CACHE_SECONDS = 2;

// GET <path>/station -> view(). Every listener polls this, so it's cached at the edge for 2s
// (the state itself advances lazily in getStation).
export async function stationResponse({ request, env, waitUntil }, cfg) {
  const cache = caches.default;
  const key = new Request(new URL(`${cfg.path}/station`, request.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;

  const { view: v } = await getStation(env, request, Date.now(), cfg);
  const res = json(v);
  res.headers.set('Cache-Control', `public, max-age=${CACHE_SECONDS}`);
  waitUntil(cache.put(key, res.clone()));
  return res;
}

// POST <path>/vote { round, track } -> view() with the fresh tally. One vote per listener (IP hash) per round;
// voting again moves it.
export async function voteResponse({ request, env }, cfg) {
  let input;
  try { input = await request.json(); } catch { return json({ error: 'Bad request' }, 400); }
  const track = String(input.track || ''), round = Number(input.round);
  if (!cfg.id.test(track) || !Number.isInteger(round)) return json({ error: 'Bad request' }, 400);

  const now = Date.now();
  const { state, catalog, recent } = await getStation(env, request, now, cfg);
  if (round !== state.round) return json({ error: 'That round is over. Vote for the next one!' }, 409);
  const v = view(state, catalog, [], recent, now);
  if (!v.voting_open) return json({ error: 'Voting for this slot just closed' }, 409);
  if (!catalog.some(t => t.id === track)) return json({ error: 'Unknown track' }, 400);
  if (!eligible(catalog, recent).includes(track)) return json({ error: 'That one played recently. Pick another!' }, 400);

  // One row per listener per round, so there's nothing to spam: voting again just moves it.
  const voter = await ipHash(env, request);
  // Keep the original time when re-voting for the same track (it's the tie-break); a new pick restarts it.
  await env.DB.prepare(
    `INSERT INTO ${cfg.votes} (round, voter, track, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (round, voter) DO UPDATE SET track = excluded.track, created_at = excluded.created_at
     WHERE ${cfg.votes}.track != excluded.track`
  ).bind(round, voter, track, now).run();

  return json({ ...view(state, catalog, await roundVotes(env, cfg, round), recent, now), my_vote: track });
}

