-- Messages (Figma 32:798) and friend requests (95:2163).
-- People can message friends; anyone else first sends a request, which the other side can
-- accept, decline or report. Groups are made by a member from their friends.
CREATE TABLE friend_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  to_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  note        text NOT NULL DEFAULT '' CHECK (char_length(note) <= 140),
  spam        text NOT NULL DEFAULT '' CHECK (spam IN ('', 'ai', 'rules')),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'reported')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz,
  CHECK (from_id <> to_id)
);
CREATE UNIQUE INDEX friend_requests_open ON friend_requests (from_id, to_id) WHERE status = 'pending';
CREATE INDEX friend_requests_to ON friend_requests (to_id, created_at DESC) WHERE status = 'pending';

-- One row per friendship, smaller id first.
CREATE TABLE friends (
  a          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  b          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (a, b),
  CHECK (a < b)
);
CREATE INDEX friends_b ON friends (b);

CREATE TABLE conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('dm', 'group')),
  name        text NOT NULL DEFAULT '' CHECK (char_length(name) <= 40),
  dm_key      text UNIQUE, -- "smaller-id:larger-id" for a dm
  created_by  uuid REFERENCES accounts(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_at     timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'dm') = (dm_key IS NOT NULL)),
  CHECK (kind = 'dm' OR char_length(name) >= 1)
);

CREATE TABLE conversation_members (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role            text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  last_read       bigint NOT NULL DEFAULT 0,
  translate       boolean NOT NULL DEFAULT true,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, account_id)
);
CREATE INDEX conversation_members_account ON conversation_members (account_id);

CREATE TABLE messages (
  id              bigserial PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       uuid REFERENCES accounts(id) ON DELETE SET NULL,
  kind            text NOT NULL CHECK (kind IN ('text', 'voice', 'photo', 'party')),
  body            text NOT NULL DEFAULT '' CHECK (char_length(body) <= 2000),
  media_key       text CHECK (media_key IS NULL OR media_key ~ '^chat/[0-9a-f-]{36}/[0-9a-f-]{36}\.(webm|ogg|mp4|m4a|jpg|png|webp)$'),
  duration_ms     integer CHECK (duration_ms IS NULL OR duration_ms BETWEEN 0 AND 300000),
  transcript      text CHECK (transcript IS NULL OR char_length(transcript) <= 4000),
  party_code      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation ON messages (conversation_id, id DESC);

-- Translations are made once per message and language.
CREATE TABLE message_translations (
  message_id bigint NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  lang       text NOT NULL,
  body       text NOT NULL,
  PRIMARY KEY (message_id, lang)
);

CREATE TABLE chat_reports (
  id          bigserial PRIMARY KEY,
  reporter_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  reported_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  request_id  uuid REFERENCES friend_requests(id) ON DELETE SET NULL,
  message_id  bigint REFERENCES messages(id) ON DELETE SET NULL,
  reason      text NOT NULL CHECK (reason IN ('harassment', 'hate', 'spam', 'scam', 'under13', 'other')),
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_reports_open ON chat_reports (status, created_at) WHERE status = 'open';
