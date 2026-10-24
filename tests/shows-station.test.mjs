// node --test tests/   (the show radio's station: catalog and vote ids from the real shows.json, no network)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STATIONS, showCatalogOf, advance, seedFromClock, rotationPreview, LOCK_MS } from '../functions/_station.js';

const program = JSON.parse(readFileSync(new URL('../shows.json', import.meta.url)));
const catalog = showCatalogOf(program);

test('every show in shows.json can be voted for (the vote endpoint accepts its id)', () => {
  const rejected = catalog.filter(s => !STATIONS.shows.id.test(s.id)).map(s => s.id);
  assert.deepEqual(rejected, []);
  assert.equal(new Set(catalog.map(s => s.id)).size, catalog.length, 'show ids are unique');
});

test('one round is a whole show: a winning vote plays the full show, then the schedule resumes', () => {
  const now = Date.parse('2026-10-24T12:00:00Z');
  const seed = seedFromClock(program, catalog, now);
  const cur = catalog.findIndex(s => s.id === seed.track);
  const end = seed.started_at + catalog[cur].duration * 1000;
  const pick = catalog[(cur + 10) % catalog.length].id;

  const won = advance(seed, catalog, [{ track: pick, created_at: now }], [seed.track], end).state;
  assert.equal(won.track, pick);
  assert.equal(won.started_at, end, 'starts when the last show ended');

  const after = advance(won, catalog, [], [pick, seed.track], end + catalog.find(s => s.id === pick).duration * 1000 - LOCK_MS).state;
  const sched = catalog.filter(s => !s.vault), k = sched.findIndex(s => s.id === seed.track);
  assert.equal(after.next_track, sched[(k + 1) % sched.length].id, 'with no votes, the soundboard after the one the schedule last played');
  assert.equal(after.next_source, 'rotation');
});

// The vault: matrix and audience tapes (shows.py) play only when voted for.
const vault = catalog.filter(s => s.vault), sched = catalog.filter(s => !s.vault);

test('shows.json: the schedule is soundboards only, and the vault holds the rest', () => {
  for (const s of program.shows) assert.equal(!!s.vault, (s.kind || 'sbd') !== 'sbd', s.show);
  assert.ok(sched.length > 0);
});

test('the vault never comes up in the rotation, the clock seed, or Coming up', () => {
  const ids = new Set(vault.map(s => s.id));
  const start = Date.parse('2026-10-24T00:00:00Z');
  let state = seedFromClock(program, catalog, start), recent = [state.track], now = start;
  assert.ok(!ids.has(state.track), 'the seed is a soundboard');
  for (let n = 0; n < sched.length + 5; n++) {   // more than one full pass of the schedule
    const end = state.started_at + catalog.find(s => s.id === state.track).duration * 1000;
    now = end;
    const out = advance(state, catalog, [], recent, now);
    state = out.state; recent = out.recent;
    assert.ok(!ids.has(state.track), `rotation played ${state.track}`);
    for (const id of rotationPreview(state, catalog, recent)) assert.ok(!ids.has(id), `Coming up lists ${id}`);
  }
});

test('adding the vault leaves the clock where it was', () => {
  const plain = { ...program, shows: program.shows.filter(s => !s.vault) };
  for (const at of ['2026-10-23T00:00:00Z', '2026-11-02T13:37:00Z', '2027-03-01T05:00:00Z']) {
    const a = seedFromClock(program, catalog, Date.parse(at)), b = seedFromClock(plain, showCatalogOf(plain), Date.parse(at));
    assert.equal(a.track, b.track, at);
    assert.equal(a.started_at, b.started_at, at);
  }
});

test('a vault show plays when it wins a vote, then the schedule picks up where it left off', { skip: !vault.length && 'no vault shows in shows.json' }, () => {
  const now = Date.parse('2026-10-24T12:00:00Z');
  const seed = seedFromClock(program, catalog, now);
  const end = seed.started_at + catalog.find(s => s.id === seed.track).duration * 1000;
  const pick = vault[0].id;
  const won = advance(seed, catalog, [{ track: pick, created_at: now }], [seed.track], end).state;
  assert.equal(won.track, pick);
  const after = advance(won, catalog, [], [pick, seed.track], end + vault[0].duration * 1000).state;
  const k = sched.findIndex(s => s.id === seed.track);
  assert.equal(after.track, sched[(k + 1) % sched.length].id);
});
