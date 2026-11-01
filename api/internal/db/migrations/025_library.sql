-- Library (Figma 19:583, Collections 101:1208, Requested 101:1387).
-- A seat for a premiere gives a 30-day replay window after the film ends. Buying the film
-- keeps it for good (and allows encrypted downloads). Collections are the viewer's own shelves.
CREATE TABLE library_keeps (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  showtime_id       text NOT NULL REFERENCES showtimes(id),
  quality           text NOT NULL DEFAULT 'hd' CHECK (quality IN ('hd', '4k')),
  amount_cents      integer NOT NULL CHECK (amount_cents > 0),
  currency          char(3) NOT NULL,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'refunded')),
  paypal_order_id   text UNIQUE,
  paypal_capture_id text UNIQUE,
  paid_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
-- One kept copy per film per viewer; a newer pending order replaces an abandoned one.
CREATE UNIQUE INDEX library_keeps_one ON library_keeps (account_id, showtime_id);

CREATE TABLE collections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  kids        boolean NOT NULL DEFAULT false,
  colors      text[] NOT NULL DEFAULT '{"#3a0d12","#120406"}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX collections_account ON collections (account_id, created_at);

CREATE TABLE collection_films (
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  showtime_id   text NOT NULL REFERENCES showtimes(id),
  added_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_id, showtime_id)
);

-- Friends a collection is shared with (they see it read-only in their Library).
CREATE TABLE collection_shares (
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_id, account_id)
);
CREATE INDEX collection_shares_account ON collection_shares (account_id);

-- Requested classics can be cleared for some countries only.
ALTER TABLE classics ADD COLUMN blocked_countries text[] NOT NULL DEFAULT '{}';
ALTER TABLE classics ADD COLUMN rights_talks boolean NOT NULL DEFAULT false;
