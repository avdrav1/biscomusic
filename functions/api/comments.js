// Comments pinned to a moment in a track.
//   GET  /api/comments?track=2026-09-01-02-jam1   -> { comments: [...] }
//   GET  /api/comments?id=42                      -> { comment }  (for shared links)
//   POST /api/comments  { track, pos, nickname?, body, token }

import { TRACK_RE, json, getComment } from '../_shared.js';
import { postComment, MOMENTS } from '../_moments.js';

export async function onRequestGet({ request, env }) {
  const params = new URL(request.url).searchParams;
  if (params.has('id')) {
    const comment = await getComment(env, params.get('id'));
    return comment ? json({ comment }) : json({ error: 'Not found' }, 404);
  }
  const track = params.get('track') || '';
  if (!TRACK_RE.test(track)) return json({ error: 'Unknown track' }, 400);
  const { results } = await env.DB.prepare(
    'SELECT id, pos, nickname, body, created_at FROM comments WHERE track = ? AND hidden = 0 ORDER BY pos LIMIT 500'
  ).bind(track).all();
  return json({ comments: results });
}

export const onRequestPost = context => postComment(context, MOMENTS.jams);
