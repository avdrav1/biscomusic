// The show radio's best moments (functions/_best.js).
//   GET /api/shows/best -> { moments: [{ track, pos, fire, comments, comment, show, n }] }

import { BEST, bestMoments } from '../../_best.js';

export const onRequestGet = context => bestMoments(context, BEST.shows);
