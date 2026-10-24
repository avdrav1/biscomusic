// The show radio: vote for the show after this one. The winner plays in full; with no votes the schedule continues.
//   POST /api/shows/vote { round, track: <show id> } -> view() with the fresh tally

import { voteResponse, STATIONS } from '../../_station.js';

export const onRequestPost = context => voteResponse(context, STATIONS.shows);
