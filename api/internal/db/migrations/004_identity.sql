-- Latest face/ID check outcome from Sumsub: pending, approved, retry or rejected.
ALTER TABLE accounts ADD COLUMN identity_status text;
ALTER TABLE accounts ADD COLUMN identity_checked_at timestamptz;
