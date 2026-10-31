-- Sign-in with Google or Apple: each provider account links to one E-Cinema account.
CREATE TABLE account_identities (
  provider    text NOT NULL CHECK (provider IN ('google', 'apple')),
  subject     text NOT NULL,
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject)
);
CREATE INDEX account_identities_account ON account_identities (account_id);
