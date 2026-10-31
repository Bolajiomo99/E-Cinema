-- Watch parties (Figma "Web / Create watch party", 31:934): a named group watching one premiere together.
CREATE TABLE parties (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9-]{6,40}$'),
  showtime_id  text NOT NULL REFERENCES showtimes(id),
  host_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  visibility   text NOT NULL CHECK (visibility IN ('link', 'invite')),
  rules        text[] NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX parties_showtime ON parties (showtime_id);

CREATE TABLE party_members (
  party_id   uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (party_id, account_id)
);
CREATE INDEX party_members_account ON party_members (account_id);

-- Invite-only parties: who the host let in (by email), before they join.
CREATE TABLE party_invites (
  party_id   uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  email      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (party_id, email)
);
