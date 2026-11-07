-- Email 41 (Figma 127:391): a monthly royalty statement with an invoice, paid in the partner
-- portal. A paid order settles that month (on time when paid by the 5th of the next month).
CREATE TABLE licence_royalty_payments (
  order_id   text PRIMARY KEY,
  licence    text NOT NULL REFERENCES brand_licensees(licence) ON DELETE CASCADE,
  month      date NOT NULL,
  amount_ngn bigint NOT NULL CHECK (amount_ngn > 0),
  account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at    timestamptz
);
CREATE INDEX licence_royalty_payments_licence ON licence_royalty_payments (licence, month);
