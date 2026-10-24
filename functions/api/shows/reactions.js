// The show radio: a flame for a moment of a show's track, one per listener per 5-second slice (functions/_moments.js).
//   POST /api/shows/reactions { track: "<show id>/<track index>", pos } -> { counted }

import { postReaction, MOMENTS } from '../../_moments.js';

export const onRequestPost = context => postReaction(context, MOMENTS.shows);
