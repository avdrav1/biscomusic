// Which site a request is for. One Pages deploy serves three host names:
//   jams.biscomusic.com   Jam Radio: the files as they are (index.html, the panels, /api)
//   shows.biscomusic.com  Show Radio: shows/index.html at / and at /best (its best moments open over it)
//   biscomusic.com        the station picker (home.html) at /, and First time played (the jam radio's panel, a
//                         page of its own for both stations) at /first-played; the jam radio's old addresses move to jams.
// First time played lives only at biscomusic.com/first-played: its address on the stations sends you there.
// Get the app's address is biscomusic.com/install, which sends you to jams (only there does the app install).
// Any other host (a *.pages.dev preview) gets the files as they are, like jams.

export const JAMS = 'jams.biscomusic.com';
export const SHOWS = 'shows.biscomusic.com';
const HOME = new Set(['biscomusic.com', 'www.biscomusic.com']);
const JAM_PAGES = /^\/(best|nominate|install)\/?$/;
const FIRST_PLAYED = /^\/first-played\/?$/;

// -> { redirect: url } | { asset: path } | null (serve the request as it is).
export function route(url) {
  const { hostname: host, pathname: path, search } = url;
  const toJams = () => ({ redirect: `https://${JAMS}${path}${search}` });
  // (With a slash after it, the page's relative links would point under /first-played/.)
  if (FIRST_PLAYED.test(path) && (HOME.has(host) || host === JAMS || host === SHOWS))
    return HOME.has(host) && path === '/first-played' ? { asset: '/first-played' } : { redirect: `https://biscomusic.com/first-played${search}` };
  if (host === SHOWS) {
    if (path === '/' || /^\/best\/?$/.test(path)) return { asset: '/shows/' };
    return JAM_PAGES.test(path) ? toJams() : null;
  }
  if (HOME.has(host)) {
    // Shared moments (?m=) and request links (?request) from before the move are jam radio links.
    if (path === '/') return url.searchParams.has('m') || url.searchParams.has('request') ? toJams() : { asset: '/home' };
    return JAM_PAGES.test(path) ? toJams() : null;
  }
  return null;
}
