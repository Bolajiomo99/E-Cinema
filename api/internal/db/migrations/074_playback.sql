-- Player reports (Figma 37:1272 control room, 35:1048 analytics, exec Live and Infrastructure):
-- each minute the player sends where it is in the film, how far it drifted from the room clock
-- and how long it stalled. Kept as per-viewer progress and per-minute totals, never raw beats.
CREATE TABLE watch_progress (
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  showtime_id text NOT NULL REFERENCES showtimes(id) ON DELETE CASCADE,
  device      text NOT NULL CHECK (device IN ('android', 'ios', 'web', 'tv', 'tablet', 'vr')),
  local_hour  smallint NOT NULL CHECK (local_hour BETWEEN 0 AND 23),
  local_dow   smallint NOT NULL CHECK (local_dow BETWEEN 0 AND 6), -- 0 is Monday
  start_ms    integer,
  max_pos     integer NOT NULL DEFAULT 0,
  first_at    timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, showtime_id)
);
CREATE INDEX watch_progress_showtime ON watch_progress (showtime_id);
CREATE INDEX watch_progress_first ON watch_progress (first_at);

CREATE TABLE playback_minutes (
  showtime_id   text NOT NULL REFERENCES showtimes(id) ON DELETE CASCADE,
  minute        timestamptz NOT NULL,
  country       text NOT NULL DEFAULT '',
  beats         integer NOT NULL DEFAULT 0,
  in_sync       integer NOT NULL DEFAULT 0,
  stalled_beats integer NOT NULL DEFAULT 0,
  stall_ms      bigint NOT NULL DEFAULT 0,
  drift_ms      bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (showtime_id, minute, country)
);
CREATE INDEX playback_minutes_minute ON playback_minutes (minute);
