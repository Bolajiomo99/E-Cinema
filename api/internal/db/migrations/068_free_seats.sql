-- Free seats (emails 22 and 31). An outage logged by the CEO or CTO can name the screening, the
-- minutes the picture was lost and the countries hit; every ticket holder who was watching gets
-- one seat of credit.
ALTER TABLE security_incidents
  ADD COLUMN IF NOT EXISTS showtime_id text REFERENCES showtimes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS outage_from timestamptz,
  ADD COLUMN IF NOT EXISTS outage_to timestamptz,
  ADD COLUMN IF NOT EXISTS countries text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS credited integer NOT NULL DEFAULT 0;
