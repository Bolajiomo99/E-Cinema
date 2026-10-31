-- One-time codes for signing in without a password and for password resets
-- (Figma "Sign in" 16:296 and the "Password recovery" frames 105:1186-105:1447).
CREATE TABLE auth_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN ('login', 'reset', 'reset-token', 'lock')),
  code_hash   bytea NOT NULL,
  tries       int NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_codes_live ON auth_codes (account_id, purpose, created_at DESC);
-- Old password hashes, so a reset cannot reuse one of the last five.
CREATE TABLE password_history (
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_history_account ON password_history (account_id, created_at DESC);
