// node --test tests/   (best moments for both stations: ranking, and each station's own tracks; no network)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rank, showTracks, BEST } from '../functions/_best.js';

const program = JSON.parse(readFileSync(new URL('../shows.json', import.meta.url)));
const tracks = showTracks(program);

test("every show radio track is in the show station's tracks", () => {
  const s = program.shows.find(x => x.vault), n = s.tracks.length - 1;
  assert.equal(tracks.size, program.shows.reduce((k, x) => k + x.tracks.length, 0));
  assert.deepEqual(tracks.get(`${s.show}/${n}`), { duration: s.tracks[n].duration, show: s.show, n });
});

test('a comment counts double, comments break ties, and tracks off the air are left out', () => {
  const [a, b, c] = program.shows.slice(0, 3).map(s => `${s.show}/0`);
  const top = rank(
    [{ track: a, w: 0, n: 3 }, { track: b, w: 2, n: 2 }, { track: '2001-01-01-nowhere/0', w: 0, n: 99 }],
    [{ track: b, w: 2, n: 1, first: 7 }, { track: c, w: 1, n: 1, first: 9 }],
    tracks);
  assert.deepEqual(top.map(m => [m.track, m.w, m.fire, m.comments, m.first]), [
    [b, 2, 2, 1, 7],      // 2 + 2·1 = 4
    [a, 0, 3, 0, null],   // 3
    [c, 1, 0, 1, 9],      // 2
  ]);
});

test("each station's SQL takes only its own tracks: show tracks have a /, jam ids don't", () => {
  const like = (sql, track) => /NOT LIKE/.test(sql) ? !track.includes('/') : track.includes('/');
  for (const t of ['2026-09-26-04-jam2', '2026-09-26-04']) { assert.ok(like(BEST.jams.mine, t)); assert.ok(!like(BEST.shows.mine, t)); }
  for (const t of tracks.keys()) { assert.ok(like(BEST.shows.mine, t), t); assert.ok(!like(BEST.jams.mine, t), t); }
});
