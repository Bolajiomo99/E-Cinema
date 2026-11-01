-- Coming soon (Figma "Web / Coming soon"): screenings months out, bookable now at the pre-order price.
INSERT INTO studios (name, payout_email) VALUES
  ('Kumo Animation', 'payouts+kumo@e-cinema.net'),
  ('Starlight Pictures', 'payouts+starlight@e-cinema.net'),
  ('Starlight Kids', 'payouts+starlightkids@e-cinema.net')
ON CONFLICT (name) DO NOTHING;

INSERT INTO showtimes (id, film, studio, starts_at, duration_min, capacity, price_cents, currency, adult) VALUES
  ('neon-shrine-2026-11-21', 'Neon Shrine', 'Kumo Animation', '2026-11-21T18:00:00Z', 108, 30000, 599, 'USD', false),
  ('iron-delta-2026-12-14', 'Iron Delta', 'Starlight Pictures', '2026-12-14T19:00:00Z', 130, 80000, 799, 'USD', false),
  ('winter-in-busan-2027-01-02', 'Winter in Busan', 'Hanbit Story House', '2027-01-02T12:00:00Z', 70, 40000, 549, 'USD', false),
  ('the-last-durbar-2027-03-27', 'The Last Durbar', 'Sahel Lantern Films', '2027-03-27T18:00:00Z', 152, 65000, 699, 'USD', false),
  ('little-orbit-2-2027-10-30', 'Little Orbit 2', 'Starlight Kids', '2027-10-30T15:00:00Z', 92, 50000, 499, 'USD', false)
ON CONFLICT (id) DO NOTHING;

-- What the studio's share is worked out from: the seat price actually charged, before VAT
-- (pre-order and member savings come off, the late-entry fee goes on). Older holds have none
-- and fall back to seats x list price.
ALTER TABLE holds ADD COLUMN net_cents integer CHECK (net_cents >= 0);
