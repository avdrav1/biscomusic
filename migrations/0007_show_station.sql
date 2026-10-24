-- Biscuits Show Radio's voting: the jam station's three tables (0004, 0005) again, for the show station.
-- functions/_station.js runs both with the same code; here one round is one whole show, and `track` holds
-- the show's id (its BIP slug, as in shows.json) rather than a jam's.
CREATE TABLE show_station (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  version           INTEGER NOT NULL,
  round             INTEGER NOT NULL,
  track             TEXT    NOT NULL,
  started_at        INTEGER NOT NULL,
  cursor            INTEGER NOT NULL,
  next_track        TEXT,
  next_source       TEXT,
  next_votes        INTEGER,
  next_cursor       INTEGER,
  cursor_track      TEXT,
  next_cursor_track TEXT
);

CREATE TABLE show_votes (
  round      INTEGER NOT NULL,
  voter      TEXT    NOT NULL,
  track      TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (round, voter)
) WITHOUT ROWID;
CREATE INDEX show_votes_by_voter ON show_votes (voter, created_at);

CREATE TABLE show_plays (
  round      INTEGER PRIMARY KEY,
  track      TEXT    NOT NULL,
  started_at INTEGER NOT NULL,
  source     TEXT    NOT NULL,
  votes      INTEGER NOT NULL DEFAULT 0
);
