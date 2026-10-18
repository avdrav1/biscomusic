-- Remember the rotation's place by track id, not catalog position: adding shows that sort
-- earlier (older dates) shifts every index, which would make the rotation jump.
ALTER TABLE station ADD COLUMN cursor_track TEXT;
ALTER TABLE station ADD COLUMN next_cursor_track TEXT;
