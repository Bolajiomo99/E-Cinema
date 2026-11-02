-- Piracy protection (Figma 39:578): leaks a studio reports, traced through the viewer code
-- burned into every stream, and the accounts E-Cinema closes for sharing films.
ALTER TABLE accounts
  ADD COLUMN banned_at  timestamptz,
  ADD COLUMN ban_reason text NOT NULL DEFAULT '';

CREATE TABLE studio_leaks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio        text NOT NULL REFERENCES studios(name) ON DELETE CASCADE ON UPDATE CASCADE,
  showtime_id   text REFERENCES showtimes(id),
  kind          text NOT NULL CHECK (kind IN ('clip', 'full', 'screenshot', 'other')),
  place         text NOT NULL CHECK (place IN ('website', 'telegram', 'tiktok', 'youtube', 'x', 'instagram', 'facebook', 'whatsapp', 'other')),
  link          text NOT NULL CHECK (link ~ '^https?://' AND char_length(link) <= 500),
  what          text NOT NULL DEFAULT '' CHECK (char_length(what) <= 200),
  code          text NOT NULL DEFAULT '' CHECK (code ~ '^([A-Z2-9]{2}-[A-Z2-9]{5})?$'),
  account_id    uuid REFERENCES accounts(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'takedown_sent', 'taken_down', 'allowed')),
  ban           text NOT NULL DEFAULT '' CHECK (ban IN ('', 'requested', 'banned', 'declined')),
  notice        text NOT NULL DEFAULT '' CHECK (char_length(notice) <= 6000),
  reported_by   uuid REFERENCES accounts(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz,
  taken_down_at timestamptz,
  ban_at        timestamptz
);
CREATE INDEX studio_leaks_studio ON studio_leaks (studio, created_at DESC);
CREATE INDEX studio_leaks_bans ON studio_leaks (created_at) WHERE ban = 'requested';
