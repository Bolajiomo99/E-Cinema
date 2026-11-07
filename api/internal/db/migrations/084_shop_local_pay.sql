-- Shop orders can be paid through Paystack or Flutterwave too. Their reference (PSK-/FLW-) is
-- kept in paypal_order_id, the column every payment confirmation looks orders up by.
ALTER TABLE shop_orders DROP CONSTRAINT IF EXISTS shop_orders_method_check;
ALTER TABLE shop_orders ADD CONSTRAINT shop_orders_method_check CHECK (method IN ('paypal', 'cod', 'paystack', 'flutterwave'));
