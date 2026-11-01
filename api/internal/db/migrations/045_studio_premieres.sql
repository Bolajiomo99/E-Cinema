-- Premieres and pricing (Figma 35:514): when a studio's film screens, how many seats, the rules,
-- and the ticket price in each country. Publishing creates (or updates) the film's showtime.
CREATE TABLE studio_premieres (
  upload            uuid PRIMARY KEY REFERENCES studio_uploads(id) ON DELETE CASCADE,
  showtime_id       text UNIQUE REFERENCES showtimes(id),
  mode              text NOT NULL DEFAULT 'global' CHECK (mode IN ('global', 'rolling', 'waves')),
  starts_at         timestamptz,
  seats             integer NOT NULL DEFAULT 5000 CHECK (seats BETWEEN 10 AND 1000000),
  encores           integer NOT NULL DEFAULT 2 CHECK (encores BETWEEN 0 AND 5),
  price_cents       integer NOT NULL DEFAULT 499 CHECK (price_cents BETWEEN 99 AND 10000),
  free_seats        boolean NOT NULL DEFAULT true,
  free_plan         boolean NOT NULL DEFAULT true,
  group_discounts   boolean NOT NULL DEFAULT true,
  student_price     boolean NOT NULL DEFAULT true,
  classic_requests  boolean NOT NULL DEFAULT true,
  downloads         boolean NOT NULL DEFAULT false,
  published_at      timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE studio_prices (
  upload        uuid NOT NULL REFERENCES studio_uploads(id) ON DELETE CASCADE,
  country       char(2) NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  currency      char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount_minor  bigint NOT NULL CHECK (amount_minor > 0 AND amount_minor < 100000000000),
  note          text NOT NULL DEFAULT '' CHECK (length(note) <= 160),
  PRIMARY KEY (upload, country)
);
