-- Notifications and re-engagement (Figma 51:375): announcements the CEO or CMO sends to members
-- in the app and by email, optionally translated into each member's app language.
CREATE TABLE exec_campaigns (
  id          bigserial PRIMARY KEY,
  title       text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 120),
  body        text NOT NULL DEFAULT '' CHECK (char_length(body) <= 300),
  link        text NOT NULL DEFAULT '' CHECK (link = '' OR link ~ '^/[A-Za-z0-9/_?=&.-]*$'),
  audience    text NOT NULL CHECK (audience IN ('everyone', 'lapsed', 'country')),
  country     text NOT NULL DEFAULT '' CHECK (country = '' OR country ~ '^[A-Z]{2}$'),
  channels    text[] NOT NULL CHECK (channels <@ ARRAY['inapp', 'email']::text[] AND cardinality(channels) > 0),
  status      text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'sending', 'sent', 'cancelled')),
  send_at     timestamptz NOT NULL,
  test_sent   int NOT NULL DEFAULT 0,
  sent        int NOT NULL DEFAULT 0,
  emailed     int NOT NULL DEFAULT 0,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);
CREATE INDEX exec_campaigns_due ON exec_campaigns (send_at) WHERE status = 'scheduled';
-- Claude's translation of a campaign for one app language.
CREATE TABLE exec_campaign_texts (
  campaign_id bigint NOT NULL REFERENCES exec_campaigns(id) ON DELETE CASCADE,
  lang        text NOT NULL CHECK (lang ~ '^[a-z]{2,3}(-[A-Za-z]{2,4})?$'),
  title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  body        text NOT NULL DEFAULT '' CHECK (char_length(body) <= 300),
  PRIMARY KEY (campaign_id, lang)
);
ALTER TABLE notifications ADD COLUMN campaign_id bigint REFERENCES exec_campaigns(id) ON DELETE SET NULL;
CREATE INDEX notifications_campaign ON notifications (campaign_id) WHERE campaign_id IS NOT NULL;
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN
  ('premiere', 'language', 'party', 'reply', 'share', 'gift', 'friend', 'payment', 'refund', 'lottery', 'signin', 'follow', 'like', 'comment', 'news'));
