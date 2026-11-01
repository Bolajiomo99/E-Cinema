-- Sold out (Figma "Web / Sold out · free-seat lottery", 31:1121): when a premiere sells out,
-- one extra free seat per 40 sold opens by lottery, and a waitlist forms for returned paid seats.
ALTER TABLE holds ADD COLUMN lottery boolean NOT NULL DEFAULT false;

CREATE TABLE lottery_entries (
  id          bigserial PRIMARY KEY,
  showtime_id text NOT NULL REFERENCES showtimes(id),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  won         boolean NOT NULL DEFAULT false,
  UNIQUE (showtime_id, account_id)
);

-- The seed's hash is published when entries open; the seed itself after the draw, so anyone
-- can re-run the draw and check the winners.
CREATE TABLE lottery_draws (
  showtime_id text PRIMARY KEY REFERENCES showtimes(id),
  seed        bytea NOT NULL,
  seed_hash   bytea NOT NULL,
  seats       int,
  entries     int,
  drawn_at    timestamptz
);

CREATE TABLE waitlist (
  showtime_id text NOT NULL REFERENCES showtimes(id),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz,
  PRIMARY KEY (showtime_id, account_id)
);
