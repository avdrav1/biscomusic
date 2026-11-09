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

test("every show's jam links to its show on BIP", () => {
  for (const t of schedule.tracks.filter(t => !t.mix))
    assert.match(t.show || '', new RegExp(`^${t.date}-[a-z0-9-]+$`), `${trackIdOf(t)}: show on its date`);
});

test('malformed ids are refused', () => {
  for (const id of ['', 'mix-', 'mix-a', 'mix-Best-01', 'mix-a/01', '2026-09-26', '2026-09-26-4', '../2026-09-26-04'])
    assert.ok(!TRACK_RE.test(id), id);
});

test("the rotation is shuffled: a show's or a mix's tracks don't play back to back", () => {
  const rot = schedule.tracks.filter(t => !t.vault), group = t => t.show || t.mix || t.date;
  const repeats = rot.slice(1).filter((t, k) => group(t) === group(rot[k])).length;
  assert.ok(repeats < rot.length * 0.02, `${repeats} back-to-back tracks from one show or mix`);
  const inOrder = rot.slice(1).filter((t, k) => trackIdOf(t) > trackIdOf(rot[k])).length;
  assert.ok(inOrder < rot.length * 0.7, 'not in date order');
});

test('tracks of hours play only by request: the vault', () => {
  for (const t of schedule.tracks) assert.equal(!!t.vault, t.duration > 90 * 60, `${trackIdOf(t)} (${Math.round(t.duration / 60)} min)`);
  assert.equal(schedule.tracks.filter(t => t.vault).length, 2, "the 2019 mix's two long parts");
});
