// The jam radio's live listener count (functions/_presence.js).
//   GET  /api/presence                    -> { listening }
//   POST /api/presence  { id, leaving? }  -> { listening }

import { presenceGet, presencePost } from '../_presence.js';

export const onRequestGet = context => presenceGet(context, 'jams');
export const onRequestPost = context => presencePost(context, 'jams');
