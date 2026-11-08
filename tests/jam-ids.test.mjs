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

test("a mix's track names its show when its title gave one, else its mix, never its placeholder date", () => {
  const mix = schedule.tracks.filter(t => t.mix);
  for (const t of mix) {
    assert.match(trackIdOf(t), /^mix-/);
    if (t.show) {
      assert.match(t.show, new RegExp(`^${t.date}-`), `${t.song}: its show is on its date`);
      assert.ok(t.venue && t.city, t.song);
      assert.equal(showLine(t), showLine({ date: t.date, venue: t.venue, city: t.city }));
    } else {
      assert.equal(showLine(t), `Mix · ${t.mix}`);
      assert.match(t.date, /-01-01$/);
    }
  }
  assert.ok(mix.filter(t => t.show).length > mix.length * 0.9, 'most mix tracks know their show');
});

test('malformed ids are refused', () => {
  for (const id of ['', 'mix-', 'mix-a', 'mix-Best-01', 'mix-a/01', '2026-09-26', '2026-09-26-4', '../2026-09-26-04'])
    assert.ok(!TRACK_RE.test(id), id);
});
