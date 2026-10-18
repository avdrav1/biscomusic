-- Listener voting: the station's on-air state is now shared server state (one row),
-- advanced lazily by /api/station. See functions/_station.js.
CREATE TABLE station (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  version     INTEGER NOT NULL,          -- bumped on every write (optimistic concurrency)
  round       INTEGER NOT NULL,          -- one round = one track on air
  track       TEXT    NOT NULL,
  started_at  INTEGER NOT NULL,          -- unix ms
  cursor      INTEGER NOT NULL,          -- catalog index of the last track the rotation played
  next_track  TEXT,                      -- set when voting locks (45s before the end)
  next_source TEXT,                      -- 'vote' | 'rotation'
  next_votes  INTEGER,
  next_cursor INTEGER
);

-- One vote per listener per round; voting again replaces it.
CREATE TABLE votes (
  round      INTEGER NOT NULL,
  voter      TEXT    NOT NULL,           -- salted IP hash
  track      TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (round, voter)
) WITHOUT ROWID;
CREATE INDEX votes_by_voter ON votes (voter, created_at);

-- What played, newest round last ("recently played", history).
CREATE TABLE plays (
  round      INTEGER PRIMARY KEY,
  track      TEXT    NOT NULL,
  started_at INTEGER NOT NULL,
  source     TEXT    NOT NULL,           -- 'seed' | 'vote' | 'rotation'
  votes      INTEGER NOT NULL DEFAULT 0
);
