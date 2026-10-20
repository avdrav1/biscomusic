// node --test tests/   (BIP song catalog trimming: no network)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compact, eraOf } from '../functions/_songs.js';

const venue = (name, city, state, country = 'United States') => ({ name, city, state, country });
const show = (date, slug, v) => ({ date, slug, venue: v });

test('eras follow BIP boundaries, inclusive, with the 2005 drummer search between them', () => {
  assert.equal(eraOf('1995-12-31'), 'Sammy');
  assert.equal(eraOf('2005-08-27'), 'Sammy');
  assert.equal(eraOf('2005-08-28'), 'Between');
  assert.equal(eraOf('2005-12-27'), 'Between');
  assert.equal(eraOf('2005-12-28'), 'Allen');
  assert.equal(eraOf('2025-09-07'), 'Allen');
  assert.equal(eraOf('2025-09-08'), 'Between');
  assert.equal(eraOf('2025-10-31'), 'Marlon');
});

test('compact keeps debut and last show, places, and sorts by debut then title', () => {
  const raw = [
    { slug: 'b', title: 'basis', kind: 'original', timesPlayed: 3, showsSinceLastPlayed: 0,
      authors: [{ name: 'Jon Gutwillig', slug: 'jon', musicianSlug: 'jon-gutwillig' }, { name: 'Taper', slug: 'taper' }],
      firstPlayedShow: show('1996-01-01', 's1', venue('Silo', 'Reading', 'PA')),
      lastPlayedShow: show('2026-10-11', 's2', venue('Brixton', 'London', null, 'United Kingdom')) },
    { slug: 'a', title: 'Above', timesPlayed: 1, firstPlayedShow: show('1996-01-01', 's1', venue('Silo', 'Reading', 'PA')) },
    { slug: 'z', title: 'Zero', firstPlayedShow: show('1995-05-05', 's0', null) },
    { slug: 'never', title: 'Never played' },
  ];
  const { songs } = compact(raw);
  assert.deepEqual(songs.map(s => s.slug), ['z', 'a', 'b']);
  const [zero, above, basis] = songs;
  assert.deepEqual(basis.authors, [{ name: 'Jon Gutwillig', href: '/musicians/jon-gutwillig' }, { name: 'Taper', href: '/authors/taper' }]);
  assert.equal(basis.place, 'Reading, PA');
  assert.deepEqual(basis.last, { date: '2026-10-11', show: 's2', venue: 'Brixton', place: 'London, United Kingdom' });
  // Played once: BIP may leave lastPlayedShow out, and the debut is the last show.
  assert.deepEqual(above.last, { date: '1996-01-01', show: 's1', venue: 'Silo', place: 'Reading, PA' });
  assert.equal(above.kind, 'unknown');
  assert.equal(zero.venue, 'Unknown venue');
  assert.equal(zero.place, '');
  assert.equal(zero.plays, 0);
});
