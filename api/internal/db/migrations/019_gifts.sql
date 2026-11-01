-- Gift a seat (Figma "Web / Gift a seat", 94:1398): a premiere seat, a plan, or credit,
-- paid by one account and redeemed by anyone with the code. Credit is a simple ledger.
CREATE TABLE gifts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              text NOT NULL UNIQUE,
  giver_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('seat', 'pro1', 'vip3', 'credit')),
  showtime_id       text REFERENCES showtimes(id),
  hold_id           uuid REFERENCES holds(id),
  amount_cents      int NOT NULL CHECK (amount_cents > 0),
  currency          text NOT NULL,
  recipient_name    text NOT NULL,
  recipient_email   text,
  recipient_phone   text,
  message           text NOT NULL DEFAULT '',
  deliver_at        timestamptz NOT NULL DEFAULT now(),
  delivered_at      timestamptz,
  paypal_order_id   text UNIQUE,
  paypal_capture_id text UNIQUE,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'redeemed')),
  redeemed_by       uuid REFERENCES accounts(id) ON DELETE SET NULL,
  redeemed_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (recipient_email IS NOT NULL OR recipient_phone IS NOT NULL),
  CHECK ((kind = 'seat') = (showtime_id IS NOT NULL))
);
CREATE INDEX gifts_due ON gifts (deliver_at) WHERE status = 'paid' AND delivered_at IS NULL;
CREATE INDEX gifts_giver ON gifts (giver_id, created_at DESC);

CREATE TABLE credits (
  id           bigserial PRIMARY KEY,
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  delta_cents  int NOT NULL,
  currency     text NOT NULL DEFAULT 'USD',
  reason       text NOT NULL,
  ref          text NOT NULL UNIQUE, -- gift id or hold id, so nothing is credited or spent twice
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE accounts ADD COLUMN plan_gift_until timestamptz;
