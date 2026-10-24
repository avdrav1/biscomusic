// The jam radio's best moments (functions/_best.js).
//   GET /api/best -> { moments: [{ track, pos, fire, comments, comment, song, jam, date, venue, city }] }

import { BEST, bestMoments } from '../_best.js';

export const onRequestGet = context => bestMoments(context, BEST.jams);
