-- Report and block (Figma 96:1378). Reports are private; three different people reporting the
-- same message hide it for everyone until a moderator looks.
CREATE TABLE room_reports (
  id          bigserial PRIMARY KEY,
  reporter_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  reported_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  message_id  bigint REFERENCES room_messages(id) ON DELETE SET NULL,
  showtime_id text NOT NULL REFERENCES showtimes(id),
  reason      text NOT NULL CHECK (reason IN ('harassment', 'hate', 'spoilers', 'spam', 'recording', 'under13', 'other')),
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX room_reports_once ON room_reports (reporter_id, message_id);
CREATE INDEX room_reports_open ON room_reports (status, created_at) WHERE status = 'open';

CREATE TABLE blocks (
  blocker_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
