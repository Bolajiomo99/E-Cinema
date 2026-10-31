-- Viewer accounts: one verified person per account, a small number of signed-in devices.
CREATE TABLE accounts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text NOT NULL UNIQUE CHECK (email = lower(email)),
  name               text NOT NULL,
  password_hash      text NOT NULL,
  phone              text,
  phone_verified_at  timestamptz,
  face_verified_at   timestamptz,
  id_verified_at     timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
-- A verified phone number can hold only one account.
CREATE UNIQUE INDEX accounts_verified_phone ON accounts (phone) WHERE phone_verified_at IS NOT NULL;

-- Only a SHA-256 of each session token is stored, so a database leak cannot sign anyone in.
CREATE TABLE account_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash    bytea NOT NULL UNIQUE,
  device        text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz
);
CREATE INDEX account_sessions_live ON account_sessions (account_id) WHERE revoked_at IS NULL;

CREATE TABLE phone_codes (
  account_id  uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  phone       text NOT NULL,
  code_hash   bytea NOT NULL,
  attempts    integer NOT NULL DEFAULT 0,
  sent_at     timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

-- Failed sign-ins, used to slow down password guessing.
CREATE TABLE sign_in_failures (
  email  text NOT NULL,
  at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sign_in_failures_recent ON sign_in_failures (email, at);
