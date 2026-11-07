-- Email 02 (Figma 106:60): new accounts confirm their email with a 6-digit code at sign-up
-- (Verify step, Figma 16:259). Accounts made before this, and Google sign-ups (Google has
-- already checked the address), count as confirmed.
ALTER TABLE accounts ADD COLUMN email_verified_at timestamptz;
UPDATE accounts SET email_verified_at = created_at;
ALTER TABLE auth_codes DROP CONSTRAINT auth_codes_purpose_check;
ALTER TABLE auth_codes ADD CONSTRAINT auth_codes_purpose_check CHECK (purpose IN ('login', 'reset', 'reset-token', 'lock', 'adult', 'adult-grant', 'student', 'email'));
