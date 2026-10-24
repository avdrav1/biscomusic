// node --test tests/   (the show radio's station: catalog and vote ids from the real shows.json, no network)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STATIONS, showCatalogOf, advance, seedFromClock, LOCK_MS } from '../functions/_station.js';

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
  assert.equal(after.next_track, catalog[(cur + 1) % catalog.length].id, 'with no votes, the show after the one the schedule last played');
  assert.equal(after.next_source, 'rotation');
});
