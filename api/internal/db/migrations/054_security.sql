-- Security operations (Figma 117:1773): lock down mode and the incident log.
CREATE TABLE security_settings (
  id           int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  lockdown     boolean NOT NULL DEFAULT false, -- no sign-ups and no sign-ins from new devices, executives excepted
  lockdown_by  text NOT NULL DEFAULT '',
  lockdown_at  timestamptz
);
INSERT INTO security_settings (id) VALUES (1);

CREATE TABLE security_incidents (
  id          bigserial PRIMARY KEY,
  title       text NOT NULL CHECK (length(title) BETWEEN 3 AND 140),
  kind        text NOT NULL CHECK (kind IN ('attack', 'breach', 'pentest', 'bounty', 'outage', 'other')),
  severity    text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  note        text NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_by  text NOT NULL,
  opened_at   timestamptz NOT NULL DEFAULT now(),
  closed_at   timestamptz
);
CREATE INDEX security_incidents_open ON security_incidents (status, opened_at DESC);
CREATE INDEX sign_in_failures_at ON sign_in_failures (at);
