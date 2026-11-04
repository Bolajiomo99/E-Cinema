-- PayPal and AI agents (Figma 285:373): which seats the AI concierge booked, and PayPal
-- disputes as the webhook reports them.
ALTER TABLE holds ADD COLUMN IF NOT EXISTS via text NOT NULL DEFAULT 'web' CHECK (via IN ('web', 'concierge'));

CREATE TABLE IF NOT EXISTS paypal_disputes (
  id            text PRIMARY KEY,
  capture_id    text NOT NULL DEFAULT '',
  amount_cents  bigint NOT NULL DEFAULT 0,
  currency      text NOT NULL DEFAULT 'USD',
  reason        text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'OPEN',
  due_at        timestamptz,
  opened_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  outcome       text NOT NULL DEFAULT '',
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS paypal_disputes_capture ON paypal_disputes (capture_id);
