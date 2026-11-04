-- Weekly encores of the launch lineup: each film in the fixed lineup (web/lib/catalog.ts) comes
-- back at the same weekday and time every week once its premiere has started, so the site always
-- has screenings on sale until studios publish their own. Encore ids are <film slug>-<date>.
ALTER TABLE showtimes ADD COLUMN IF NOT EXISTS encore_of text REFERENCES showtimes(id);
ALTER TABLE showtimes ADD COLUMN IF NOT EXISTS encore_weekly boolean NOT NULL DEFAULT false;
UPDATE showtimes SET encore_weekly = true WHERE id IN (
  'tide-of-lagos-2026-11-01', 'monsoon-hearts-2026-11-01', 'the-last-harmattan-2026-11-01', 'orbit-zero-2026-11-01',
  'the-kano-ledger-2026-11-02', 'red-earth-2026-11-02', 'velvet-hour-2026-11-02', 'seoul-after-rain-2026-11-03',
  'lagos-lights-2026-11-04', 'moonlight-fox-2026-11-07', 'kofi-and-the-drum-2026-11-14', 'neon-shrine-2026-11-21',
  'starship-mama-2026-11-28', 'iron-delta-2026-12-14', 'winter-in-busan-2027-01-02', 'the-last-durbar-2027-03-27',
  'little-orbit-2-2027-10-30');
