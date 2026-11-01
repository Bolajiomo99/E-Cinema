-- Refund or replacement requests on delivered store orders (Figma 96:1426 "Request a refund").
CREATE TABLE shop_refunds (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL UNIQUE REFERENCES shop_orders(id) ON DELETE CASCADE,
  account_id  uuid REFERENCES accounts(id) ON DELETE SET NULL,
  reason      text NOT NULL CHECK (reason IN ('late', 'wrong', 'damaged', 'never')),
  note        text NOT NULL DEFAULT '',
  outcome     text NOT NULL CHECK (outcome IN ('refund', 'replace')),
  status      text NOT NULL CHECK (status IN ('approved', 'review', 'declined')),
  amount_ngn  int NOT NULL CHECK (amount_ngn >= 0),
  paypal_refund_id text,
  credit_cents int NOT NULL DEFAULT 0, -- pay-on-delivery refunds go to the wallet
  sent_at     timestamptz,            -- a replacement handed to a rider
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz
);
CREATE INDEX shop_refunds_review ON shop_refunds (created_at) WHERE status = 'review';
CREATE INDEX shop_refunds_to_send ON shop_refunds (decided_at) WHERE status = 'approved' AND outcome = 'replace' AND sent_at IS NULL;
