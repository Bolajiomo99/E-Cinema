-- Executive invites (Figma 99:1696). A new executive stays pending until they open the one-time
-- link, prove they own the invited inbox with a code, pass the face check and add a passkey.
-- People granted access before invites existed are not pending.
ALTER TABLE executives ADD COLUMN pending boolean NOT NULL DEFAULT false;

CREATE TABLE exec_invites (
  token_hash          bytea PRIMARY KEY,
  email               text NOT NULL REFERENCES executives(email) ON DELETE CASCADE ON UPDATE CASCADE,
  by_name             text NOT NULL DEFAULT '',
  code_hash           bytea,
  code_sent_at        timestamptz,
  code_tries          int NOT NULL DEFAULT 0,
  email_confirmed_at  timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  used_at             timestamptz
);
CREATE INDEX exec_invites_email ON exec_invites (email);
