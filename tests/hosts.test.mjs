// node --test tests/   (host routing of the three sites: no network)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { route } from '../functions/_hosts.js';

const at = u => route(new URL(u));

test('biscomusic.com shows the station picker, whatever else is in the query', () => {
  assert.deepEqual(at('https://biscomusic.com/'), { asset: '/home' });
  assert.deepEqual(at('https://www.biscomusic.com/?utm_source=x'), { asset: '/home' });
});

test('old jam radio links on biscomusic.com move to jams, query intact', () => {
  assert.deepEqual(at('https://biscomusic.com/?m=2026-09-26-04-jam2@312&c=7'),
    { redirect: 'https://jams.biscomusic.com/?m=2026-09-26-04-jam2@312&c=7' });
  assert.deepEqual(at('https://biscomusic.com/?request'), { redirect: 'https://jams.biscomusic.com/?request' });
  assert.deepEqual(at('https://biscomusic.com/first-played?song=42'), { redirect: 'https://jams.biscomusic.com/first-played?song=42' });
  assert.deepEqual(at('https://biscomusic.com/best/'), { redirect: 'https://jams.biscomusic.com/best/' });
});

test('shows.biscomusic.com plays the show radio at /, and sends jam pages to jams', () => {
  assert.deepEqual(at('https://shows.biscomusic.com/'), { asset: '/shows/' });
  assert.deepEqual(at('https://shows.biscomusic.com/nominate'), { redirect: 'https://jams.biscomusic.com/nominate' });
});

test('the jam radio, the API and previews are served as they are', () => {
  assert.equal(at('https://jams.biscomusic.com/'), null);
  assert.equal(at('https://jams.biscomusic.com/best'), null);
  assert.equal(at('https://biscomusic.com/api/station'), null);
  assert.equal(at('https://abc123.biscomusic.pages.dev/'), null);
  assert.equal(at('https://shows.biscomusic.com/bestest'), null);
});
