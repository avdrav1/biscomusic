// "/" with ?m=<track>@<seconds>[&c=<comment id>]: same page, but the link preview
// describes that moment (song, show, comment) instead of the generic station blurb.

import { findTrack, getComment, parseMoment, fmt } from './_shared.js';

export async function onRequestGet(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const moment = parseMoment(url.searchParams.get('m'));
  if (!moment) return next();

  const res = await next();
  const t = await findTrack(env, request, moment.track);
  if (!t || moment.pos > t.duration) return res;

  const comment = url.searchParams.has('c') ? await getComment(env, url.searchParams.get('c')) : null;
  const useComment = comment && comment.track === moment.track;
  const date = new Date(t.date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const title = `${t.song}${t.jam ? ` (jam ${t.jam})` : ''} @ ${fmt(moment.pos)} · Jam Radio · biscomusic`;
  const show = `${date} · ${t.venue} · ${t.city}`;
  const description = useComment
    ? `“${comment.body}” — ${comment.nickname || 'anonymous'} · ${show}`
    : `A moment from ${show}. Everyone hears the same moment on biscomusic Jam Radio.`;

  const set = value => ({ element: el => el.setAttribute('content', value) });
  return new HTMLRewriter()
    .on('meta[property="og:title"]', set(title))
    .on('meta[name="twitter:title"]', set(title))
    .on('meta[property="og:description"]', set(description))
    .on('meta[name="twitter:description"]', set(description))
    .on('meta[property="og:url"]', set(url.toString()))
    .transform(res);
}
