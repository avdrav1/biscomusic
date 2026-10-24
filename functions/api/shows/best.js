// The show radio's best moments (functions/_best.js).
//   GET /api/shows/best -> { moments: [{ track, pos, fire, comments, comment, show, n, title, date, venue, place, vault }] }

import { BEST, bestMoments } from '../../_best.js';

export const onRequestGet = context => bestMoments(context, BEST.shows);
