-- Kids premieres shown in the kids cinema (Figma 89:1020, "Ada's cinema"). Invented titles and studios.
INSERT INTO showtimes (id, film, studio, starts_at, duration_min, capacity, price_cents, currency, adult) VALUES
  ('moonlight-fox-2026-11-07', 'Moonlight Fox', 'Baobab Kids Studio', '2026-11-07T14:00:00Z', 84, 40000, 299, 'USD', false),
  ('kofi-and-the-drum-2026-11-14', 'Kofi and the Drum', 'Baobab Kids Studio', '2026-11-14T14:00:00Z', 78, 40000, 299, 'USD', false),
  ('starship-mama-2026-11-28', 'Starship Mama', 'Starlight Kids', '2026-11-28T15:00:00Z', 88, 40000, 299, 'USD', false)
ON CONFLICT (id) DO NOTHING;
