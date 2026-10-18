// node --test tests/   (pure station logic: no D1, no network)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, seedFromClock, catalogOf, eligible, rotationPreview, view, LOCK_MS, RECENT } from '../functions/_station.js';

// Ten 100-second tracks, t0..t9, in rotation order.
const schedule = {
  epoch: '2026-01-01T00:00:00Z',
  tracks: Array.from({ length: 10 }, (_, i) => ({ file: `https://audio.example/t${i}.mp3?v=abc`, duration: 100 })),
};
const catalog = catalogOf(schedule);
const T0 = Date.parse('2026-10-18T12:00:00Z');
const start = (track = 't0', cursor = 0) =>
  ({ version: 3, round: 1, track, started_at: T0, cursor, next_track: null, next_source: null, next_votes: null, next_cursor: null });
const vote = (track, at = T0 + 1000) => ({ track, created_at: at });

test('catalog ids ignore the ?v= cache-buster', () => {
  assert.deepEqual(catalog.slice(0, 2), [{ id: 't0', duration: 100 }, { id: 't1', duration: 100 }]);
});

test('before the lock nothing changes', () => {
  const out = advance(start(), catalog, [vote('t5')], ['t0'], T0 + 100_000 - LOCK_MS - 1);
  assert.equal(out.changed, false);
  assert.equal(out.state.next_track, null);
});

test('no votes: locks the next track in rotation order, then plays it', () => {
  const locked = advance(start(), catalog, [], ['t0'], T0 + 100_000 - LOCK_MS);
  assert.equal(locked.changed, true);
  assert.equal(locked.state.next_track, 't1');
  assert.equal(locked.state.next_source, 'rotation');
  const played = advance(locked.state, catalog, [], ['t0'], T0 + 100_000);
  assert.equal(played.state.track, 't1');
  assert.equal(played.state.round, 2);
  assert.equal(played.state.started_at, T0 + 100_000, 'starts exactly when the last one ended');
  assert.deepEqual(played.plays, [{ round: 2, track: 't1', started_at: T0 + 100_000, source: 'rotation', votes: 0 }]);
});

test('a vote wins at the lock, and the rotation resumes where it left off', () => {
  // On air: t0 (rotation cursor 0). Two votes for t6, one for t3.
  const votes = [vote('t6', T0 + 2000), vote('t3', T0 + 1000), vote('t6', T0 + 3000)];
  const a = advance(start(), catalog, votes, ['t0'], T0 + 100_000);
  assert.equal(a.state.track, 't6');
  assert.equal(a.plays[0].source, 'vote');
  assert.equal(a.plays[0].votes, 2);
  assert.equal(a.state.cursor, 0, 'a voted track does not move the rotation');
  // Nobody votes during t6: back to the rotation after t0, i.e. t1.
  const b = advance(a.state, catalog, [], a.recent, T0 + 200_000);
  assert.equal(b.state.track, 't1');
  assert.equal(b.state.cursor, 1);
});

test('ties: earliest first vote wins, then nearest in rotation order', () => {
  const byTime = advance(start(), catalog, [vote('t7', T0 + 5000), vote('t4', T0 + 6000)], ['t0'], T0 + 60_000);
  assert.equal(byTime.state.next_track, 't7');
  const sameTime = advance(start(), catalog, [vote('t7', T0 + 5000), vote('t4', T0 + 5000)], ['t0'], T0 + 60_000);
  assert.equal(sameTime.state.next_track, 't4');
});

test('the current track and the last few played can\'t be picked, by vote or by rotation', () => {
  const recent = ['t0', 't1', 't2', 't3', 't4', 't5'];   // t0 on air, t1..t5 just played
  assert.equal(RECENT, 5);
  assert.deepEqual(eligible(catalog, recent), ['t6', 't7', 't8', 't9']);
  // Votes only for blocked tracks are ignored -> rotation, which also skips them.
  const out = advance(start('t0', 0), catalog, [vote('t0'), vote('t2'), vote('t5')], recent, T0 + 60_000);
  assert.equal(out.state.next_source, 'rotation');
  assert.equal(out.state.next_track, 't6');
});

test('changing a vote counts once (votes table keeps one row per voter; the tally sees the latest)', () => {
  // The DB upserts (round, voter), so the tally only ever sees each voter's current pick.
  const out = advance(start(), catalog, [vote('t8')], ['t0'], T0 + 60_000);
  assert.equal(out.state.next_track, 't8');
  assert.equal(out.state.next_votes, 1);
});

test('after an idle stretch it fast-forwards through the rotation and lands mid-track', () => {
  const out = advance(start(), catalog, [], ['t0'], T0 + 3_650_000);   // 36.5 tracks later
  assert.equal(out.state.round, 37);
  assert.equal(out.state.started_at, T0 + 3_600_000);
  assert.ok(out.plays.length <= RECENT * 2, 'only recent plays are recorded');
  assert.equal(out.state.track, out.recent[0]);
  // Never repeats within the recent window while fast-forwarding.
  const window = out.recent.slice(0, RECENT + 1);
  assert.equal(new Set(window).size, window.length);
});

test('two requests at the same moment compute the same result (the version check keeps one write)', () => {
  const now = T0 + 100_000;
  const a = advance(start(), catalog, [vote('t9')], ['t0'], now);
  const b = advance(start(), catalog, [vote('t9')], ['t0'], now);
  assert.deepEqual(a, b);
});

test('seeding from the old clock lands on the same track and offset', () => {
  const now = Date.parse(schedule.epoch) + (2 * 1000 + 3) * 1000 + 250;   // 2 loops + 3s... of 1000s each
  const s = seedFromClock(schedule, catalog, now);
  assert.equal(s.track, 't0');
  assert.equal(now - s.started_at, 3250);
  const later = Date.parse(schedule.epoch) + 451_500;
  const s2 = seedFromClock(schedule, catalog, later);
  assert.equal(s2.track, 't4');
  assert.equal(later - s2.started_at, 51_500);
  assert.equal(s2.cursor, 4);
});

test('a track removed from the catalog ends immediately', () => {
  const out = advance(start('gone', 2), catalog, [], ['gone'], T0 + 1);
  assert.equal(out.state.track, 't3');
});

test('view: voting window, tally and the rotation preview', () => {
  const v = view(start(), catalog, [vote('t5'), vote('t5'), vote('t2')], ['t0'], T0 + 10_000);
  assert.equal(v.voting_open, true);
  assert.equal(v.lock_at, T0 + 100_000 - LOCK_MS);
  assert.deepEqual(v.tally, [['t5', 2], ['t2', 1]]);
  assert.deepEqual(v.rotation, ['t1', 't2', 't3', 't4', 't5']);
  const locked = advance(start(), catalog, [vote('t5')], ['t0'], T0 + 60_000).state;
  const lv = view(locked, catalog, [], ['t0'], T0 + 60_000);
  assert.equal(lv.voting_open, false);
  assert.deepEqual(lv.next, { track: 't5', source: 'vote', votes: 1 });
  assert.deepEqual(rotationPreview(locked, catalog, ['t0'], 3), ['t1', 't2', 't3']);
});
