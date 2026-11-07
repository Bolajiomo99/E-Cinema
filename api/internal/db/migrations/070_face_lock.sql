-- Email 33 (Figma 127:215): five failed face checks within 10 minutes lock the account. Every
-- device is signed out and nobody can sign in until the owner enters the emailed code and passes
-- a new face check on /unlock.
ALTER TABLE accounts ADD COLUMN face_locked_at timestamptz;
CREATE TABLE face_failures (
	account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
	attempt text NOT NULL,
	device text NOT NULL DEFAULT '',
	place text NOT NULL DEFAULT '',
	at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (account_id, attempt)
);
ALTER TABLE auth_codes DROP CONSTRAINT auth_codes_purpose_check;
ALTER TABLE auth_codes ADD CONSTRAINT auth_codes_purpose_check CHECK (purpose IN ('login', 'reset', 'reset-token', 'lock', 'adult', 'adult-grant', 'student', 'email', 'unlock', 'unlock-token'));
