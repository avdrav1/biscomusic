// Shared by index.html and first-played.html: every Disco Biscuits song's debut and history
// (/api/songs, live from BIP) joined with its archive.org recordings (/clips.json, made by build.py).

// -> { fetched, site, eras, songs, bySlug } or null when there's no API (local server.py) or BIP is down.
// Each song: { slug, title, kind, authors: [{ name, href }], date, show, venue, place, era, plays,
//              last: { date, show, venue, place }, since, debut: Clip|null, latest: Clip|null, top: [Version] }
// Clip: { url, item, track, length, how, date, show, venue, place }; how is "title" or "setlist" (the
// debut itself), "later" (the debut wasn't taped: earliest recording that exists), "latest" or "top".
// Version: one of the song's best rated performances, best first (up to 3, none if it was played once or
// nobody rated it): { date, show, venue, place, score, bip: { rating, votes }|null,
// ia: { rating, reviews }|null, all_timer, clip: Clip|null }. bip rates this performance; ia rates the
// whole night's recordings on archive.org (sound included). score ranks them (see ratings.py).
export async function loadSongs() {
  const get = url => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const [catalog, clips] = await Promise.all([get('/api/songs'), get('/clips.json')]);
  if (!catalog?.songs) return null;
  return join(catalog, clips);
}

export function join(catalog, clips) {
  const byClip = clips?.clips || {};
  const songs = catalog.songs.map(s => {
    const c = byClip[s.slug] || {};
    return { ...s, debut: c.debut || null, latest: c.latest || null, top: c.top || [] };
  });
  return { ...catalog, songs, bySlug: new Map(songs.map(s => [s.slug, s])) };
}

// A BIP page: bip(catalog, 'shows', song.show), bip(catalog, 'songs', song.slug), bip(catalog, author.href).
export const bip = (catalog, ...path) => `${catalog.site}/${path.join('/').replace(/^\/+/, '')}`;

// "1996-07-14" -> "Jul 14, 1996"
export const fmtDate = iso =>
  new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

// "Played once", "Played 312 times"
export const playsText = song => (song.plays === 1 ? 'Played once' : `Played ${song.plays.toLocaleString('en-US')} times`);

// How long since the last performance, in shows: "last show", "1 show ago", "38 shows ago".
export const sinceText = song => (song.since === 0 ? 'last show' : song.since === 1 ? '1 show ago' : `${song.since} shows ago`);
