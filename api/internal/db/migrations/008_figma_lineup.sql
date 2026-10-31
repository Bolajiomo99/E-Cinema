-- The premieres shown on the landing page design, as real bookable screenings.
-- Adult screenings can only be booked by viewers who passed the face and ID check.
ALTER TABLE showtimes ADD COLUMN adult boolean NOT NULL DEFAULT false;

INSERT INTO studios (name, payout_email) VALUES
  ('Sahel Lantern Films', 'payouts+sahellantern@e-cinema.net'),
  ('Saffron Reel Studios', 'payouts+saffronreel@e-cinema.net'),
  ('Northlight Pictures', 'payouts+northlight@e-cinema.net'),
  ('Arewa Frame House', 'payouts+arewaframe@e-cinema.net'),
  ('Maison Velours', 'payouts+velours@e-cinema.net')
ON CONFLICT (name) DO NOTHING;

INSERT INTO showtimes (id, film, studio, starts_at, duration_min, capacity, price_cents, currency, adult) VALUES
  ('tide-of-lagos-2026-11-01', 'Tide of Lagos', 'Lagoon Gate Pictures', '2026-11-01T16:00:00Z', 112, 20000, 499, 'USD', false),
  ('the-last-harmattan-2026-11-01', 'The Last Harmattan', 'Sahel Lantern Films', '2026-11-01T19:30:00Z', 131, 65000, 599, 'USD', false),
  ('monsoon-hearts-2026-11-01', 'Monsoon Hearts', 'Saffron Reel Studios', '2026-11-01T19:00:00Z', 146, 30000, 499, 'USD', false),
  ('orbit-zero-2026-11-01', 'Orbit Zero', 'Northlight Pictures', '2026-11-01T21:30:00Z', 124, 40000, 699, 'USD', false),
  ('the-kano-ledger-2026-11-02', 'The Kano Ledger', 'Arewa Frame House', '2026-11-02T18:00:00Z', 109, 15000, 449, 'USD', false),
  ('velvet-hour-2026-11-02', 'Velvet Hour', 'Maison Velours', '2026-11-02T22:00:00Z', 98, 10000, 799, 'USD', true)
ON CONFLICT (id) DO NOTHING;
