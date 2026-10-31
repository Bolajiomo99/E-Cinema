-- Paid plans are PayPal subscriptions. A viewer on an active paid plan who picks another
-- keeps the current one until the new subscription is approved (pending_plan).
ALTER TABLE accounts
  ADD COLUMN pending_plan           text CHECK (pending_plan IN ('student', 'pro', 'vip', 'enterprise')),
  ADD COLUMN paypal_subscription_id text,
  ADD COLUMN plan_renews_at         timestamptz;
CREATE UNIQUE INDEX accounts_paypal_subscription ON accounts (paypal_subscription_id) WHERE paypal_subscription_id IS NOT NULL;
