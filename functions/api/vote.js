// The jam radio: vote for the next jam. One vote per listener (IP hash) per round; voting again moves it.
//   POST /api/vote { round, track } -> view() with the fresh tally

import { voteResponse, STATIONS } from '../_station.js';

export const onRequestPost = context => voteResponse(context, STATIONS.jams);
