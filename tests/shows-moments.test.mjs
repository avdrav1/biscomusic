// node --test tests/   (the show radio's comments and flames: track keys from the real shows.json, no network)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TRACK_RE, SHOW_TRACK_RE, showTrackOf } from '../functions/_shared.js';

const program = JSON.parse(readFileSync(new URL('../shows.json', import.meta.url)));
const keys = program.shows.flatMap(s => s.tracks.map((t, n) => ({ key: `${s.show}/${n}`, show: s.show, t })));

test('every track of every show has a key the comment and flame endpoints accept', () => {
  for (const { key, t } of keys) {
    assert.ok(SHOW_TRACK_RE.test(key), key);
    assert.equal(showTrackOf(program, key), t, key);
    assert.ok(!TRACK_RE.test(key), `${key} must not look like a jam id`);
  }
});

test('keys past the end of a show, of unknown shows, or malformed find nothing', () => {
  const s = program.shows[0];
  for (const key of [`${s.show}/${s.tracks.length}`, '2001-01-01-nowhere/0', `${s.show}/`, `${s.show}/x`, `${s.show}/1/2`, s.show, ''])
    assert.equal(showTrackOf(program, key), undefined, key);
});

test("a show's moments query (track > '<show>/' and < '<show>0') takes exactly its own tracks", () => {
  for (const s of program.shows) {
    const lo = s.show + '/', hi = s.show + '0';
    const got = keys.filter(k => k.key > lo && k.key < hi).map(k => k.key);
    assert.deepEqual(got.sort(), keys.filter(k => k.show === s.show).map(k => k.key).sort(), s.show);
  }
  // Show ids that start with another show's id stay out of its range.
  assert.ok(!('2001-01-01-club-metronome/0' > '2001-01-01-club/'), 'a longer id with "-" sorts before the range');
  assert.ok(!('2001-01-01-club0/0' < '2001-01-01-club0'), 'a longer id with a digit sorts after the range');
});
