-- Licence renewals and plan upgrades paid with PayPal (Figma 116:726 "Renew").
CREATE TABLE licence_renewals (
  order_id   text PRIMARY KEY,
  licence    text NOT NULL REFERENCES brand_licensees(licence) ON DELETE CASCADE,
  plan       text NOT NULL CHECK (plan IN ('starter', 'growth')),
  fee_ngn    int NOT NULL CHECK (fee_ngn > 0),
  account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at    timestamptz
);
CREATE INDEX licence_renewals_licence ON licence_renewals (licence, created_at DESC);
