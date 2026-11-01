-- Pre-show quiz in the lobby (Figma "Web / Room lobby", 30:989): one try per viewer per premiere;
-- five right answers win a seat's worth of credit.
CREATE TABLE quiz_attempts (
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  showtime_id text NOT NULL REFERENCES showtimes(id),
  score       int  NOT NULL CHECK (score BETWEEN 0 AND 5),
  prize_cents int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, showtime_id)
);
