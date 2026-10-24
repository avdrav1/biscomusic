// The jam radio: what's on air, what's next, and the live vote count.
//   GET /api/station -> view() in functions/_station.js (cached at the edge for 2s)

import { stationResponse, STATIONS } from '../_station.js';

export const onRequestGet = context => stationResponse(context, STATIONS.jams);
