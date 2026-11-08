// node --test tests/   (the jam radio's track ids, shows' jams and mixes' tracks, from the real schedule.json, no network)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TRACK_RE, SHOW_RE, trackIdOf, parseMoment, showLine } from '../functions/_shared.js';

const schedule = JSON.parse(readFileSync(new URL('../schedule.json', import.meta.url)));

test('every track has a unique id the comment, flame and moment endpoints accept', () => {
  const ids = schedule.tracks.map(trackIdOf);
  assert.equal(new Set(ids).size, ids.length, 'track ids collide');
  for (const id of ids) {
    assert.ok(TRACK_RE.test(id), id);
    assert.ok(!SHOW_RE.test(id) || /^\d{4}-\d{2}-\d{2}-\d{2}(-jam\d+)?$/.test(id), `${id} must not look like a show id`);
    assert.deepEqual(parseMoment(`${id}@12`), { track: id, pos: 12 });
  }
});

test("a mix's track names its mix, never its placeholder date", () => {
  for (const t of schedule.tracks.filter(t => t.mix)) {
    assert.match(trackIdOf(t), /^mix-/);
    assert.equal(showLine(t), `Mix · ${t.mix}`);
  }
});

test('malformed ids are refused', () => {
  for (const id of ['', 'mix-', 'mix-a', 'mix-Best-01', 'mix-a/01', '2026-09-26', '2026-09-26-4', '../2026-09-26-04'])
    assert.ok(!TRACK_RE.test(id), id);
});
