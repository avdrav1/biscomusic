-- Listener counts per station: the jam radio's tabs and the show radio's are counted apart (functions/_presence.js).
-- Rows from before this are jam radio tabs.
ALTER TABLE presence ADD COLUMN station TEXT NOT NULL DEFAULT 'jams';
DROP INDEX presence_by_seen;
CREATE INDEX presence_by_station ON presence (station, seen);
