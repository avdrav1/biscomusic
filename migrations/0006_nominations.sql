-- Nominations: listeners upvote performances from the Nugs catalog (site/nominees.json)
-- that they'd like added to the station. One upvote per listener per performance.
CREATE TABLE nominations (
  track      INTEGER NOT NULL,           -- Nugs track id
  voter      TEXT    NOT NULL,           -- salted IP hash
  created_at INTEGER NOT NULL,           -- unix ms
  PRIMARY KEY (track, voter)
) WITHOUT ROWID;
CREATE INDEX nominations_by_voter ON nominations (voter, created_at);
