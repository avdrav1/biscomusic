// What's on air, decided by listener votes, falling back to the catalog rotation.
//
// There's no server process: every /api/station request runs advance(), which locks in the next
// track once voting closes (LOCK_MS before the end) and moves to it once the current track ends,
// fast-forwarding through any idle stretch. Writes use optimistic concurrency (version column).

import { trackIdOf } from './_shared.js';

export const LOCK_MS = 45_000;     // voting closes this long before the end (the player preloads then)
export const RECENT = 5;           // the current track and the N before it can't be voted for or rotated back in

// Catalog in rotation order: [{ id, duration }] (seconds), from schedule.json.
export const catalogOf = schedule => schedule.tracks.map(t => ({ id: trackIdOf(t), duration: t.duration }));

// Where the old clock-only station would be right now, so switching to voting doesn't jump.
export function seedFromClock(schedule, catalog, now) {
  const total = catalog.reduce((s, t) => s + t.duration, 0);
  let pos = ((now - Date.parse(schedule.epoch)) / 1000) % total;
  let i = 0;
  while (pos >= catalog[i].duration) { pos -= catalog[i].duration; i++; }
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

// The rotation's next pick after `cursor`, skipping anything played recently (or already chosen).
export function rotationNext(catalog, cursor, recent, skip = []) {
  const ok = new Set(eligible(catalog, recent)), n = catalog.length;
  for (const s of skip) ok.delete(s);
  for (let k = 1; k <= n; k++) {
    const i = (cursor + k) % n;
    if (ok.has(catalog[i].id)) return i;
  }
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

async function load(env) {
  const [st, rec] = await env.DB.batch([
    env.DB.prepare(`SELECT ${COLS} FROM station WHERE id = 1`),
    env.DB.prepare(`SELECT track FROM plays ORDER BY round DESC LIMIT ${RECENT * 2}`),
  ]);
  return { state: st.results[0] || null, recent: rec.results.map(r => r.track) };
}

const roundVotes = (env, round) =>
  env.DB.prepare('SELECT track, created_at FROM votes WHERE round = ?').bind(round).all().then(r => r.results);

async function schedule(env, request) {
  return env.ASSETS.fetch(new URL('/schedule.json', request.url)).then(r => r.json());
}

// Current state (advanced to `now` and saved), plus everything the player needs.
export async function getStation(env, request, now = Date.now()) {
  const sched = await schedule(env, request), catalog = catalogOf(sched);
  for (let attempt = 0; attempt < 4; attempt++) {
    let { state, recent } = await load(env);
    if (!state) {
      const seed = seedFromClock(sched, catalog, now);
      const r = await env.DB.prepare(`INSERT OR IGNORE INTO station (id, ${COLS}) VALUES (1, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, NULL)`)
        .bind(seed.version, seed.round, seed.track, seed.started_at, seed.cursor, seed.cursor_track).run();
      if (r.meta.changes) await env.DB.prepare("INSERT OR IGNORE INTO plays (round, track, started_at, source) VALUES (?, ?, ?, 'seed')")
        .bind(seed.round, seed.track, seed.started_at).run();
      continue;   // re-read whichever seed won
    }
    const votes = await roundVotes(env, state.round);
    const out = advance(state, catalog, votes, recent, now);
    if (out.changed) {
      const s = out.state;
      const w = await env.DB.prepare(
        `UPDATE station SET version = version + 1, round = ?, track = ?, started_at = ?, cursor = ?, cursor_track = ?,
           next_track = ?, next_source = ?, next_votes = ?, next_cursor = ?, next_cursor_track = ? WHERE id = 1 AND version = ?`
      ).bind(s.round, s.track, s.started_at, s.cursor, s.cursor_track, s.next_track, s.next_source, s.next_votes, s.next_cursor,
             s.next_cursor_track, state.version).run();
      if (!w.meta.changes) continue;   // someone else advanced it first; start over from their state
      if (out.plays.length) await env.DB.batch(out.plays.map(p =>
        env.DB.prepare('INSERT OR IGNORE INTO plays (round, track, started_at, source, votes) VALUES (?, ?, ?, ?, ?)')
          .bind(p.round, p.track, p.started_at, p.source, p.votes)));
      s.version = state.version + 1;
      const fresh = s.round === state.round ? votes : [];
      return { state: s, catalog, recent: out.recent, votes: fresh, view: view(s, catalog, fresh, out.recent, now) };
    }
    return { state, catalog, recent, votes, view: view(state, catalog, votes, recent, now) };
  }
  throw new Error('station is busy');
}

