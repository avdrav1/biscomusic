// Every Disco Biscuits song from the Biscuits Internet Project (BIP), trimmed for the radio:
// debut, last played, play count. Pure, so tests/songs.test.mjs can run it on a fixture.

export const BIP = 'https://discobiscuits.net';

// Era boundaries exactly as BIP's own "Sammy/Allen/Marlon Era" filter defines them. Dates outside every
// range (the fall-2005 drummer search) are "Between", not forced into a neighbour.
export const ERAS = [
  { name: 'Sammy', drummer: 'Sam Altman', start: null, end: '2005-08-27' },
  { name: 'Allen', drummer: 'Allen Aucoin', start: '2005-12-28', end: '2025-09-07' },
  { name: 'Marlon', drummer: 'Marlon Lewis', start: '2025-10-31', end: null },
];

export const eraOf = date =>
  ERAS.find(e => (!e.start || date >= e.start) && (!e.end || date <= e.end))?.name || 'Between';

// "Philadelphia, PA" in the US, "London, United Kingdom" elsewhere.
const placeOf = (venue = {}) => {
  const region = ['', 'United States'].includes(venue.country || '') ? venue.state : venue.country;
  return [venue.city, region].filter(Boolean).join(', ');
};

const showOf = show => ({
  date: show.date,
  show: show.slug,
  venue: show.venue?.name || 'Unknown venue',
  place: placeOf(show.venue || {}),
});

// BIP /api/songs (about 2 MB: lyrics, tabs, per-year stats) -> { eras, songs } (about 150 KB).
// Songs without a debut show are left out; the rest are sorted by debut, then title.
export function compact(raw) {
  const songs = raw.filter(s => s.firstPlayedShow).map(s => {
    const first = showOf(s.firstPlayedShow);
    return {
      slug: s.slug,
      title: s.title,
      kind: s.kind || 'unknown',
      authors: (s.authors || []).map(a => ({
        name: a.name,
        href: a.musicianSlug ? `/musicians/${a.musicianSlug}` : `/authors/${a.slug}`,
      })),
      ...first,
      era: eraOf(first.date),
      plays: s.timesPlayed || 0,
      last: showOf(s.lastPlayedShow || s.firstPlayedShow),
      since: s.showsSinceLastPlayed || 0,
    };
  });
  songs.sort((a, b) => a.date.localeCompare(b.date) || a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
  return { site: BIP, eras: ERAS, songs };
}
