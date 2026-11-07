-- Studio webhooks (Figma 39:1073 "Webhooks and API"): endpoints a studio registers to hear
-- ticket.sold, premiere.started, payout.sent and leak.detected, and every delivery with its
-- retries. Each body is signed with the endpoint's secret.
CREATE TABLE studio_webhooks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio      text NOT NULL REFERENCES studios(name) ON DELETE CASCADE ON UPDATE CASCADE,
  url         text NOT NULL CHECK (url ~ '^https://' AND char_length(url) <= 500),
  secret      text NOT NULL CHECK (secret ~ '^whsec_[0-9a-f]{48}$'),
  events      text[] NOT NULL CHECK (cardinality(events) BETWEEN 1 AND 4),
  created_by  uuid REFERENCES accounts(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_status integer,
  last_event  text NOT NULL DEFAULT '',
  last_at     timestamptz,
  failures    integer NOT NULL DEFAULT 0
);
CREATE INDEX studio_webhooks_studio ON studio_webhooks (studio);

CREATE TABLE studio_webhook_deliveries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hook        uuid NOT NULL REFERENCES studio_webhooks(id) ON DELETE CASCADE,
  event       text NOT NULL,
  dedupe      text NOT NULL,
  payload     jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts    integer NOT NULL DEFAULT 0,
  last_status integer,
  next_at     timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz,
  UNIQUE (hook, dedupe)
);
CREATE INDEX studio_webhook_deliveries_due ON studio_webhook_deliveries (next_at) WHERE status = 'pending';
