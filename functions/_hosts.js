// Which site a request is for. One Pages deploy serves three host names:
//   jams.biscomusic.com   Biscuits Jam Radio: the files as they are (index.html, the panels, /api)
//   shows.biscomusic.com  Biscuits Show Radio: shows/index.html at /
//   biscomusic.com        the station picker (home.html) at /; the jam radio's old addresses move to jams.
// Any other host (a *.pages.dev preview) gets the files as they are, like jams.

export const JAMS = 'jams.biscomusic.com';
export const SHOWS = 'shows.biscomusic.com';
const HOME = new Set(['biscomusic.com', 'www.biscomusic.com']);
const JAM_PAGES = /^\/(best|nominate|install|first-played)\/?$/;

// -> { redirect: url } | { asset: path } | null (serve the request as it is).
export function route(url) {
  const { hostname: host, pathname: path, search } = url;
  const toJams = () => ({ redirect: `https://${JAMS}${path}${search}` });
  if (host === SHOWS) {
    if (path === '/') return { asset: '/shows/' };
    return JAM_PAGES.test(path) ? toJams() : null;
  }
  if (HOME.has(host)) {
    // Shared moments (?m=) and request links (?request) from before the move are jam radio links.
    if (path === '/') return url.searchParams.has('m') || url.searchParams.has('request') ? toJams() : { asset: '/home' };
    return JAM_PAGES.test(path) ? toJams() : null;
  }
  return null;
}
