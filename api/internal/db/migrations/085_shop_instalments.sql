-- Pay in 6 (Figma Shop 53:925 hero, Cart 53:1111): the first part is paid on Paystack's page,
-- which saves the card; the other five are charged to that card a month apart.
ALTER TABLE shop_orders DROP CONSTRAINT IF EXISTS shop_orders_method_check;
ALTER TABLE shop_orders ADD CONSTRAINT shop_orders_method_check CHECK (method IN ('paypal', 'cod', 'paystack', 'flutterwave', 'instalments'));

CREATE TABLE IF NOT EXISTS shop_instalments (
  order_id    uuid PRIMARY KEY REFERENCES shop_orders(id) ON DELETE CASCADE,
  parts       int NOT NULL CHECK (parts BETWEEN 2 AND 12),
  part_ngn    int NOT NULL CHECK (part_ngn > 0),
  total_ngn   int NOT NULL CHECK (total_ngn > 0),
  paid_parts  int NOT NULL DEFAULT 0,
  auth_code   text NOT NULL DEFAULT '',
  email       text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'done', 'failed', 'stopped')),
  attempts    int NOT NULL DEFAULT 0,
  next_due    timestamptz,
  last_ref    text NOT NULL DEFAULT '',
  last_error  text NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shop_instalments_due ON shop_instalments (next_due) WHERE status = 'active';
