-- Error alerts: every crash a viewer or the servers hit, grouped by where it happened, so the
-- tech team is emailed about new problems and can see how often each one happens.
CREATE TABLE app_errors (
  fingerprint  text PRIMARY KEY,              -- source + message + first stack line, hashed
  source       text NOT NULL CHECK (source IN ('browser', 'web', 'api')),
  message      text NOT NULL,
  stack        text NOT NULL DEFAULT '',
  path         text NOT NULL DEFAULT '',      -- the page or route of the latest sighting
  agent        text NOT NULL DEFAULT '',      -- browser of the latest sighting
  release      text NOT NULL DEFAULT '',      -- commit of the latest sighting
  count        int NOT NULL DEFAULT 1,
  first_seen   timestamptz NOT NULL DEFAULT now(),
  last_seen    timestamptz NOT NULL DEFAULT now(),
  alerted_at   timestamptz,                   -- last alert email
  resolved_at  timestamptz                    -- set by the tech team; a new sighting reopens it
);
CREATE INDEX app_errors_recent ON app_errors (last_seen DESC);
