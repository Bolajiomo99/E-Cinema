-- Email outbox (Figma page 08 Emails, 106:5). The API queues an email when something happens or
-- when a scheduled email falls due; the web app renders the design for each kind and sends it
-- through Resend, then marks it sent. A dedupe key makes each email go out once.
CREATE TABLE mail_outbox (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL,
  to_email    text NOT NULL,
  to_name     text NOT NULL DEFAULT '',
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe      text UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  send_after  timestamptz NOT NULL DEFAULT now(),
  claimed_at  timestamptz,
  tries       integer NOT NULL DEFAULT 0,
  sent_at     timestamptz,
  failed_at   timestamptz,
  last_error  text
);
CREATE INDEX mail_outbox_due ON mail_outbox (send_after) WHERE sent_at IS NULL AND failed_at IS NULL;

-- When a seat was paid for, so a pre-order can be told from a ticket bought close to the start.
ALTER TABLE holds ADD COLUMN paid_at timestamptz;
UPDATE holds SET paid_at = created_at WHERE status IN ('paid', 'refunded');
