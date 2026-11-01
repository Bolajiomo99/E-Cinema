-- Brand protection (Figma 114:1670, 114:1733, 114:1751, 114:1818): licensed merch partners,
-- the QR authenticity codes they print on every item, every scan of a code, and community
-- reports of fake sellers that earn points and wallet credit once an investigator confirms them.
CREATE TABLE brand_licensees (
  licence     text PRIMARY KEY CHECK (licence ~ '^[A-Z]{2}-[0-9]{4}$'),
  name        text NOT NULL,
  city        text NOT NULL DEFAULT '',
  country     text NOT NULL DEFAULT 'NG',
  website     text NOT NULL DEFAULT '', -- bare domain, so reports can tell a partner shop from a fake one
  account_id  uuid REFERENCES accounts(id) ON DELETE SET NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'ended')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE brand_codes (
  code          text PRIMARY KEY CHECK (code ~ '^EC-QR-[0-9A-Z]{4}-[0-9A-Z]{4}$'),
  licence       text NOT NULL REFERENCES brand_licensees(licence),
  product       text NOT NULL,
  batch         text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  first_scan_at timestamptz,
  scans         int NOT NULL DEFAULT 0
);
CREATE INDEX brand_codes_licence ON brand_codes (licence, created_at DESC);

-- Every check, including codes E-Cinema never issued, so copied labels show up.
CREATE TABLE brand_scans (
  id          bigserial PRIMARY KEY,
  code        text NOT NULL,
  issued      boolean NOT NULL,
  city        text NOT NULL DEFAULT '',
  country     text NOT NULL DEFAULT '',
  account_id  uuid REFERENCES accounts(id) ON DELETE SET NULL,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX brand_scans_code ON brand_scans (code, at);

CREATE TABLE brand_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  country     text NOT NULL DEFAULT '',
  place       text NOT NULL CHECK (place IN ('online', 'social', 'market', 'delivered')),
  link        text NOT NULL,
  selling     text NOT NULL,
  code        text NOT NULL DEFAULT '',
  photos      text[] NOT NULL DEFAULT '{}',
  ai_note     text NOT NULL DEFAULT '',
  anonymous   boolean NOT NULL DEFAULT false,
  status      text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'checking', 'confirmed', 'rejected', 'false')),
  outcome     text NOT NULL DEFAULT '',
  reward_ngn  int NOT NULL DEFAULT 0 CHECK (reward_ngn >= 0),
  points      int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz
);
CREATE INDEX brand_reports_account ON brand_reports (account_id, created_at DESC);
CREATE INDEX brand_reports_open ON brand_reports (created_at) WHERE status IN ('sent', 'checking');

-- The partner and labels shown in the design, so the checker works from day one.
INSERT INTO brand_licensees (licence, name, city, country, website) VALUES
  ('NG-0042', 'Lagos Threads Ltd', 'Lagos', 'NG', 'lagosthreads.ng'),
  ('NG-0051', 'Ikeja Caps & Co', 'Lagos', 'NG', ''),
  ('GB-0007', 'Brixton Print House', 'London', 'GB', '');
INSERT INTO brand_codes (code, licence, product, batch) VALUES
  ('EC-QR-7F3K-29XA', 'NG-0042', 'E-Cinema premiere tee, black', 'LT-2026-11'),
  ('EC-QR-7F3K-29XB', 'NG-0042', 'E-Cinema premiere tee, black', 'LT-2026-11'),
  ('EC-QR-8M2P-41QD', 'NG-0051', 'E-Cinema premiere cap, red', 'IC-2026-10');
