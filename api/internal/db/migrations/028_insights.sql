-- Insights (Figma "Web / Insights" 19:462). The players send a heartbeat each minute while a
-- film is actually playing; these add up to watch time per day, film, mode and language.
CREATE TABLE watch_beats (
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  showtime_id text NOT NULL REFERENCES showtimes(id),
  day         date NOT NULL,
  mode        text NOT NULL CHECK (mode IN ('room', 'replay', 'offline')),
  audio       text NOT NULL DEFAULT '',
  subs        text NOT NULL DEFAULT '',
  seconds     integer NOT NULL DEFAULT 0 CHECK (seconds >= 0),
  PRIMARY KEY (account_id, showtime_id, day, mode, audio, subs)
);
CREATE INDEX watch_beats_account_day ON watch_beats (account_id, day);

-- When each account last sent a heartbeat, so a busy script cannot inflate watch time.
CREATE TABLE watch_last (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  at         timestamptz NOT NULL
);
