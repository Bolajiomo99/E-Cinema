-- Automatic moderation of public chat and community posts. A background check reads each new
-- world-chat message, post and comment once; what it flags is kept here for a person to review,
-- and the clearest abuse is hidden straight away. Private messages and party chat are not read:
-- they rely on reports and blocking.
CREATE TABLE moderation_cursor (
  source  text PRIMARY KEY CHECK (source IN ('room', 'post', 'comment')),
  last_id bigint NOT NULL DEFAULT 0
);
-- Start from now, so old messages are not sent through the check.
INSERT INTO moderation_cursor (source, last_id) VALUES
  ('room', (SELECT coalesce(max(id), 0) FROM room_messages)),
  ('post', (SELECT coalesce(max(id), 0) FROM posts)),
  ('comment', (SELECT coalesce(max(id), 0) FROM post_comments));

CREATE TABLE auto_flags (
  source      text NOT NULL CHECK (source IN ('room', 'post', 'comment')),
  item_id     bigint NOT NULL,
  account_id  uuid REFERENCES accounts(id) ON DELETE CASCADE,
  place       text NOT NULL DEFAULT '', -- film or community the item was in
  body        text NOT NULL,
  label       text NOT NULL CHECK (label IN ('abusive', 'hateful', 'sexual', 'threat', 'selfharm', 'spam', 'scam', 'piracy')),
  pct         integer NOT NULL CHECK (pct BETWEEN 0 AND 100),
  hidden      boolean NOT NULL,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'upheld', 'restored')),
  reviewed_by text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  PRIMARY KEY (source, item_id)
);
CREATE INDEX auto_flags_open ON auto_flags (created_at DESC) WHERE status = 'open';
