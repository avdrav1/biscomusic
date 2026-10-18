-- Who's tuned in right now: one row per player tab (random id, no IP), refreshed every minute
CREATE TABLE presence (
  id   TEXT    PRIMARY KEY,
  seen INTEGER NOT NULL                 -- unix ms of the last heartbeat
) WITHOUT ROWID;
CREATE INDEX presence_by_seen ON presence (seen);
