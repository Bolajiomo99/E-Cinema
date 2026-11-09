-- Support inbox: questions people send to the E-Cinema team from Help (or that the AI concierge
-- hands over), answered by staff on the support desk. Each request has a secret link, so people
-- without an account can read the answer and reply too.
CREATE TABLE support_requests (
  id          bigserial PRIMARY KEY,
  token       text NOT NULL UNIQUE CHECK (token ~ '^[A-Za-z0-9_-]{24,64}$'),
  account_id  uuid REFERENCES accounts(id) ON DELETE SET NULL,
  email       text NOT NULL CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND char_length(email) <= 254),
  name        text NOT NULL DEFAULT '' CHECK (char_length(name) <= 80),
  topic       text NOT NULL CHECK (topic IN ('payments', 'playback', 'languages', 'account', 'kids', 'country', 'other')),
  subject     text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 140),
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'closed')),
  via         text NOT NULL DEFAULT 'form' CHECK (via IN ('form', 'concierge')),
  lang        text NOT NULL DEFAULT '' CHECK (lang ~ '^([a-z]{2,3})?$'),
  assignee    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_requests_queue ON support_requests (status, updated_at);
CREATE INDEX support_requests_account ON support_requests (account_id, updated_at DESC);

CREATE TABLE support_messages (
  id          bigserial PRIMARY KEY,
  request_id  bigint NOT NULL REFERENCES support_requests(id) ON DELETE CASCADE,
  staff       text,  -- the staff email for answers; NULL when the member wrote it
  body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_messages_request ON support_messages (request_id, id);
