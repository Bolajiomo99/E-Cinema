-- Screenings and seat holds. A hold reserves seats for a short time while the viewer pays.
CREATE TABLE showtimes (
  id            text PRIMARY KEY,
  film          text NOT NULL,
  studio        text NOT NULL,
  starts_at     timestamptz NOT NULL,
  duration_min  integer NOT NULL CHECK (duration_min > 0),
  capacity      integer NOT NULL CHECK (capacity >= 0),
  price_cents   integer NOT NULL CHECK (price_cents >= 0),
  currency      char(3) NOT NULL
);

CREATE TABLE holds (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  showtime_id      text NOT NULL REFERENCES showtimes(id),
  seats            integer NOT NULL CHECK (seats BETWEEN 1 AND 10),
  viewer_ref       text NOT NULL,
  status           text NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'paid', 'released')),
  expires_at       timestamptz NOT NULL,
  paypal_order_id  text UNIQUE,
  paypal_capture_id text UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX holds_active ON holds (showtime_id) WHERE status IN ('held', 'paid');

INSERT INTO showtimes VALUES
  ('red-earth-2026-11-02', 'Red Earth', 'Lagoon Gate Pictures', '2026-11-02T19:00:00Z', 118, 5000, 699, 'USD'),
  ('seoul-after-rain-2026-11-03', 'Seoul After Rain', 'Hanbit Story House', '2026-11-03T13:00:00Z', 104, 5000, 549, 'USD'),
  ('lagos-lights-2026-11-04', 'Lagos Lights', 'Lagoon Gate Pictures', '2026-11-04T20:00:00Z', 126, 5000, 699, 'USD');
