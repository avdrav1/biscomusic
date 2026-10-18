-- 🔥 reactions: at most one per listener per 5-second slice of a track, so counts mean "people"
CREATE TABLE reactions (
  track      TEXT    NOT NULL,
  bucket     INTEGER NOT NULL,          -- floor(pos / 5)
  ip_hash    TEXT    NOT NULL,
  created_at INTEGER NOT NULL,          -- unix ms
  PRIMARY KEY (track, bucket, ip_hash)
) WITHOUT ROWID;
CREATE INDEX reactions_by_ip ON reactions (ip_hash, created_at);
