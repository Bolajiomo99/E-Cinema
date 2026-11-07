-- Public studio page (Figma 597:27): e-cinema.net/studios/<slug> with the studio's own words,
-- its premieres, and people who follow it to hear when it announces a new film.
ALTER TABLE studios ADD COLUMN bio text NOT NULL DEFAULT '' CHECK (char_length(bio) <= 400);
CREATE TABLE studio_follows (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  studio     text NOT NULL REFERENCES studios(name) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, studio)
);
CREATE INDEX studio_follows_studio ON studio_follows (studio);
