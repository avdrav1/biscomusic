// node --test tests/   (nominations search: pure, no DOM)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, search } from '../static/nominees.js';

const tracks = load({
  shows: [
    [1, '2015-12-31', 'PlayStation Theater', 'New York, NY'],
    [2, '2019-10-04', '10 Mile Music Hall', 'Frisco, CO'],
    [3, '2026-08-29', 'Variety Playhouse', 'Atlanta, GA'],
  ],
  tracks: [
    [10, 0, 'Tron', 3600, 0],
    [11, 0, 'Crickets', 900, 0],
    [20, 1, 'Set 1 Jam', 3540, 0],
    [30, 2, 'M.E.M.P.H.I.S.', 1300, 1],
    [31, 2, "Bernstein and Chasnoff", 1500, 0],
  ],
});
const ids = r => r.map(t => t.id);

test('every word must match the start of a word in song, venue, city or date', () => {
  assert.deepEqual(ids(search(tracks, { query: 'tron 2015' })), [10]);
  assert.deepEqual(ids(search(tracks, { query: 'atlanta bern' })), [31]);
  assert.deepEqual(ids(search(tracks, { query: 'ron' })), [], 'not mid-word');
  assert.deepEqual(ids(search(tracks, { query: 'tron 2019' })), []);
});

test('dates match as ISO, m/d/yy, m/d/yyyy and m/d', () => {
  for (const q of ['2015-12-31', '12/31/15', '12/31/2015', '12/31']) assert.deepEqual(ids(search(tracks, { query: q, sort: 'old' })), [10, 11], q);
  assert.deepEqual(ids(search(tracks, { query: '10/4' })), [20]);
});

test('punctuation and case are ignored', () => {
  assert.deepEqual(ids(search(tracks, { query: 'Memphis' })), [30]);
  assert.deepEqual(ids(search(tracks, { query: 'm.e.m.p' })), [30]);
});

test('on-air flag comes through', () => {
  assert.equal(tracks.find(t => t.id === 30).onAir, true);
  assert.equal(tracks.find(t => t.id === 10).onAir, false);
});

test('sorts: most wanted (longest breaks ties), longest, newest, oldest', () => {
  const votes = new Map([[11, 3], [31, 3], [20, 1]]);
  assert.deepEqual(ids(search(tracks, { sort: 'top' }, votes)), [31, 11, 20, 10, 30]);
  assert.deepEqual(ids(search(tracks, { sort: 'long' })), [10, 20, 31, 30, 11]);
  assert.deepEqual(ids(search(tracks, { sort: 'new' })), [30, 31, 20, 10, 11]);
  assert.deepEqual(ids(search(tracks, { sort: 'old' })), [10, 11, 20, 30, 31]);
});

test('minimum length filter', () => {
  assert.deepEqual(ids(search(tracks, { sort: 'long', minMinutes: 20 })), [10, 20, 31, 30]);
  assert.deepEqual(ids(search(tracks, { sort: 'long', minMinutes: 25 })), [10, 20, 31], 'exactly 25:00 counts');
  assert.deepEqual(ids(search(tracks, { sort: 'long', minMinutes: 26 })), [10, 20]);
});
