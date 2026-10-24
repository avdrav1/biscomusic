// The show radio: which show is on air, what's next, and the live vote count. One round is one whole show.
//   GET /api/shows/station -> view() in functions/_station.js (cached at the edge for 2s)

import { stationResponse, STATIONS } from '../../_station.js';

export const onRequestGet = context => stationResponse(context, STATIONS.shows);
