-- Rewatch with friends: a shared start time for a film everyone has in their library.
CREATE TABLE rewatch_parties (
  code        text PRIMARY KEY CHECK (code ~ '^[a-z0-9]{10}$'),
  showtime_id text NOT NULL REFERENCES showtimes(id),
  host_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  starts_at   timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rewatch_parties_host ON rewatch_parties (host_id, created_at DESC);
