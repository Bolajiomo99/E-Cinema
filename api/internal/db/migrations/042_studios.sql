-- Studio portal (Figma "06 Studio Portal", 34:49 to 99:552): a studio's own record, who on its
-- team can sign in, and the onboarding steps it completes before it can list films.
ALTER TABLE studios
  ADD COLUMN slug              text UNIQUE,
  ADD COLUMN legal_name        text NOT NULL DEFAULT '',
  ADD COLUMN reg_country       text NOT NULL DEFAULT 'NG' CHECK (reg_country ~ '^[A-Z]{2}$'),
  ADD COLUMN reg_number        text NOT NULL DEFAULT '',
  ADD COLUMN city              text NOT NULL DEFAULT '',
  ADD COLUMN website           text NOT NULL DEFAULT '',
  ADD COLUMN status            text NOT NULL DEFAULT 'verified' CHECK (status IN ('draft', 'submitted', 'verified', 'rejected')),
  ADD COLUMN review_note       text NOT NULL DEFAULT '',
  ADD COLUMN docs_key          text NOT NULL DEFAULT '',
  ADD COLUMN docs_ok           boolean NOT NULL DEFAULT false,
  ADD COLUMN payout_method     text NOT NULL DEFAULT 'paypal' CHECK (payout_method IN ('paypal', 'bank')),
  ADD COLUMN payout_bank       text NOT NULL DEFAULT '',
  ADD COLUMN payout_number     text NOT NULL DEFAULT '',
  ADD COLUMN payout_name       text NOT NULL DEFAULT '',
  ADD COLUMN payout_currency   char(3) NOT NULL DEFAULT 'USD',
  ADD COLUMN rights_note       text NOT NULL DEFAULT '',
  ADD COLUMN rights_at         timestamptz,
  ADD COLUMN terms_at          timestamptz,
  ADD COLUMN created_at        timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN verified_at       timestamptz;

-- Every studio already on the schedule becomes a verified studio record.
INSERT INTO studios (name, payout_email)
SELECT DISTINCT s.studio, 'payouts+' || regexp_replace(lower(s.studio), '[^a-z0-9]+', '', 'g') || '@e-cinema.net'
FROM showtimes s
WHERE s.studio <> '' AND s.studio NOT LIKE 'Test %'
ON CONFLICT (name) DO NOTHING;
UPDATE studios SET slug = trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')), legal_name = name, verified_at = now()
WHERE slug IS NULL;

CREATE TABLE studio_members (
  studio      text NOT NULL REFERENCES studios(name) ON DELETE CASCADE ON UPDATE CASCADE,
  email       text NOT NULL,
  account_id  uuid REFERENCES accounts(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner', 'admin', 'finance', 'marketing', 'viewer')),
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (studio, email)
);
CREATE INDEX studio_members_account ON studio_members (account_id);
CREATE INDEX studio_members_email ON studio_members (email);
