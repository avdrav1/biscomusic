-- Fewer row reads (D1's free tier allows 5M a day).
-- When each jam radio track last played, one row per track. /api/catalog-stats used to work this out from all of
-- plays (MAX(started_at) GROUP BY track), reading the whole history on every call; that alone ran past D1's free
-- daily read limit. A trigger keeps this up to date as plays are added.
CREATE TABLE last_played (
  track TEXT    PRIMARY KEY,
  at    INTEGER NOT NULL
);

INSERT INTO last_played (track, at) SELECT track, MAX(started_at) FROM plays GROUP BY track;

CREATE TRIGGER plays_last_played AFTER INSERT ON plays
BEGIN
  INSERT INTO last_played (track, at) VALUES (NEW.track, NEW.started_at)
    ON CONFLICT (track) DO UPDATE SET at = MAX(at, excluded.at);
END;

-- The newest comments and flames (Lately on both stations) by time, so those queries read the latest few rows
-- instead of sorting the whole table.
CREATE INDEX comments_by_time  ON comments (created_at);
CREATE INDEX reactions_by_time ON reactions (created_at);
