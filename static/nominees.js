// Nominations logic (pure, no DOM): search and sort the Nugs catalog from nominees.json.
// Used by static/nominate.js (the /nominate panel) and tests/nominees.test.mjs.

// "M.E.M.P.H.I.S." -> "memphis", "Bogart's" -> "bogarts"; keeps / and - for dates.
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ.'’]/g, '').replace(/[^a-z0-9/-]+/g, ' ');

// nominees.json -> [{ id, title, seconds, onAir, show: { id, date, venue, city }, hay }]
export function load(data) {
  const shows = data.shows.map(([id, date, venue, city]) => ({ id, date, venue, city }));
  return data.tracks.map(([id, s, title, seconds, onAir]) => {
    const show = shows[s];
    const [y, m, d] = show.date.split('-');
    // Dates match as 2019, 2019-12-31, 12/31/19, 12/31/2019 or 12/31.
    const dates = `${show.date} ${+m}/${+d}/${y.slice(2)} ${+m}/${+d}/${y}`;
    return { id, title, seconds, onAir: !!onAir, show, hay: ' ' + norm(`${title} ${show.venue} ${show.city} ${dates}`) };
  });
}

// Every word must appear at the start of a word in the song, venue, city or date.
export function matches(track, words) {
  return words.every(w => track.hay.includes(' ' + w));
}

export const SORTS = {
  top: (a, b, votes) => (votes.get(b.id) || 0) - (votes.get(a.id) || 0) || b.seconds - a.seconds,
  long: (a, b) => b.seconds - a.seconds,
  new: (a, b) => b.show.date.localeCompare(a.show.date) || a.id - b.id,
  old: (a, b) => a.show.date.localeCompare(b.show.date) || a.id - b.id,
};

// { query, sort, minMinutes } -> matching tracks, sorted. votes: Map(track id -> count).
export function search(tracks, { query = '', sort = 'top', minMinutes = 0 } = {}, votes = new Map()) {
  const words = norm(query).split(' ').filter(Boolean);
  const cmp = SORTS[sort] || SORTS.top;
  return tracks
    .filter(t => t.seconds >= minMinutes * 60 && matches(t, words))
    .sort((a, b) => cmp(a, b, votes));
}
