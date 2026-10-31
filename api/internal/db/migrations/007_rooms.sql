-- Tickets belong to an account, so only the person who paid can enter the watch room.
ALTER TABLE holds ADD COLUMN account_id uuid REFERENCES accounts(id);
CREATE INDEX holds_account_paid ON holds (account_id, showtime_id) WHERE status = 'paid';

-- Room chat. Messages stay with the screening so late arrivals see what they missed.
CREATE TABLE room_messages (
  id          bigserial PRIMARY KEY,
  showtime_id text NOT NULL REFERENCES showtimes(id),
  account_id  uuid NOT NULL REFERENCES accounts(id),
  name        text NOT NULL,
  body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  hidden      boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX room_messages_recent ON room_messages (showtime_id, id DESC);
CREATE INDEX room_messages_by_account ON room_messages (account_id, created_at DESC);
