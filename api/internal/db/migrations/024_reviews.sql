-- Rate and review after the film (Figma 96:1302). One review per viewer per premiere.
CREATE TABLE reviews (
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  showtime_id text NOT NULL REFERENCES showtimes(id),
  stars       int NOT NULL CHECK (stars BETWEEN 1 AND 5),
  tags        text[] NOT NULL DEFAULT '{}',
  body        text NOT NULL DEFAULT '' CHECK (char_length(body) <= 500),
  hidden      boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, showtime_id)
);
CREATE INDEX reviews_showtime ON reviews (showtime_id, created_at DESC);
