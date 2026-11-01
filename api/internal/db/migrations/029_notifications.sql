-- Notifications (Figma 31:878). One row per thing worth telling a viewer about.
-- dedupe stops the same event being stored twice (a reminder, a webhook retried).
CREATE TABLE notifications (
  id          bigserial PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('premiere', 'party', 'lottery', 'reply', 'language', 'signin', 'payment', 'refund', 'share', 'gift')),
  title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  body        text NOT NULL DEFAULT '' CHECK (char_length(body) <= 300),
  link        text NOT NULL DEFAULT '' CHECK (link = '' OR link ~ '^/[A-Za-z0-9/_?=&.-]*$'),
  dedupe      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);
CREATE INDEX notifications_account ON notifications (account_id, created_at DESC);
CREATE INDEX notifications_unread ON notifications (account_id) WHERE read_at IS NULL;
CREATE UNIQUE INDEX notifications_dedupe ON notifications (account_id, dedupe) WHERE dedupe IS NOT NULL;
