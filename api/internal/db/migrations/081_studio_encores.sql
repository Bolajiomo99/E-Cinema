-- Encores after sell-out (Studio / Premieres, Figma 36:617): when a studio premiere sells every
-- seat, the next encore is proposed a week later and goes on sale once the studio approves it.
CREATE TABLE studio_encores (
  origin      text NOT NULL REFERENCES showtimes(id) ON DELETE CASCADE,
  n           int NOT NULL CHECK (n BETWEEN 1 AND 5),
  starts_at   timestamptz NOT NULL,
  status      text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'declined')),
  showtime_id text REFERENCES showtimes(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz,
  decided_by  uuid REFERENCES accounts(id) ON DELETE SET NULL,
  PRIMARY KEY (origin, n)
);
CREATE INDEX studio_encores_showtime ON studio_encores (showtime_id) WHERE showtime_id IS NOT NULL;
