// The show radio: comment on a moment of a show's track (functions/_moments.js).
//   POST /api/shows/comments { track: "<show id>/<track index>", pos, nickname?, body, token } -> { comment }

import { postComment, MOMENTS } from '../../_moments.js';

export const onRequestPost = context => postComment(context, MOMENTS.shows);
