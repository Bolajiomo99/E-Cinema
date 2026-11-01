-- Watch room side panel (Figma 17:562, 95:1008, 95:1269): party and world chat, translations,
-- voice notes and attachments, polls, and free talk time.
ALTER TABLE room_messages
  ADD COLUMN party_id uuid REFERENCES parties(id) ON DELETE CASCADE,
  ADD COLUMN lang     text NOT NULL DEFAULT '',
  ADD COLUMN country  text NOT NULL DEFAULT '',
  ADD COLUMN kind     text NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'voice', 'image', 'file')),
  ADD COLUMN media    jsonb,
  ADD COLUMN spoiler  boolean NOT NULL DEFAULT false;
CREATE INDEX room_messages_party ON room_messages (party_id, id DESC) WHERE party_id IS NOT NULL;

-- One translation per message and language, made once and shared by everyone reading in it.
CREATE TABLE room_translations (
  message_id bigint NOT NULL REFERENCES room_messages(id) ON DELETE CASCADE,
  lang       text NOT NULL,
  body       text NOT NULL,
  PRIMARY KEY (message_id, lang)
);

-- A poll belongs to a party (room poll) or to the whole premiere (world poll, party_id NULL).
CREATE TABLE room_polls (
  id          bigserial PRIMARY KEY,
  showtime_id text NOT NULL REFERENCES showtimes(id),
  party_id    uuid REFERENCES parties(id) ON DELETE CASCADE,
  question    text NOT NULL CHECK (char_length(question) BETWEEN 1 AND 120),
  options     text[] NOT NULL CHECK (cardinality(options) BETWEEN 2 AND 4),
  created_by  uuid REFERENCES accounts(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX room_polls_showtime ON room_polls (showtime_id, id);
CREATE UNIQUE INDEX room_polls_one_world ON room_polls (showtime_id) WHERE party_id IS NULL AND created_by IS NULL;

CREATE TABLE room_poll_votes (
  poll_id    bigint NOT NULL REFERENCES room_polls(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  choice     int NOT NULL,
  lang       text NOT NULL DEFAULT '',
  voted_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (poll_id, account_id)
);

-- Seconds of voice each viewer has used per premiere; free members get a few minutes.
CREATE TABLE talk_time (
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  showtime_id text NOT NULL REFERENCES showtimes(id),
  seconds     int NOT NULL DEFAULT 0 CHECK (seconds >= 0),
  PRIMARY KEY (account_id, showtime_id)
);
