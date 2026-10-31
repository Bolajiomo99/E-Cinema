-- Passkeys (WebAuthn): sign in with a fingerprint or face instead of a password.
CREATE TABLE passkeys (
  id            bytea PRIMARY KEY,
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  credential    jsonb NOT NULL,
  name          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz
);
CREATE INDEX passkeys_account ON passkeys (account_id);

-- One-time WebAuthn challenges, valid for five minutes.
CREATE TABLE webauthn_challenges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid REFERENCES accounts(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('register', 'login')),
  data        jsonb NOT NULL,
  expires_at  timestamptz NOT NULL
);
