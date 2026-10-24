// The show radio's live listener count (functions/_presence.js).
//   GET  /api/shows/presence                    -> { listening }
//   POST /api/shows/presence  { id, leaving? }  -> { listening }

import { presenceGet, presencePost } from '../../_presence.js';

export const onRequestGet = context => presenceGet(context, 'shows');
export const onRequestPost = context => presencePost(context, 'shows');
