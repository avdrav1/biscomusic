-- Comments pinned to a moment in a track (track = mp3 name without .mp3, pos = seconds)
CREATE TABLE comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  track      TEXT    NOT NULL,
  pos        REAL    NOT NULL,
  nickname   TEXT,
  body       TEXT    NOT NULL,
  created_at INTEGER NOT NULL,          -- unix ms
  ip_hash    TEXT    NOT NULL,          -- salted hash, for rate limits and moderation only
  hidden     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX comments_by_track ON comments (track, hidden, pos);
CREATE INDEX comments_by_ip    ON comments (ip_hash, created_at);
