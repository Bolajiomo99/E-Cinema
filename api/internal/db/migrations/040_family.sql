-- Family and kids profiles (Figma 89:1020): up to 6 profiles per account, parental controls,
-- a parent PIN, screen time and kids' purchase requests.
ALTER TABLE accounts
  ADD COLUMN parent_pin_hash         text,
  ADD COLUMN parent_pin_tries        int NOT NULL DEFAULT 0,
  ADD COLUMN parent_pin_paused_until timestamptz;

CREATE TABLE profiles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 30),
  kind           text NOT NULL CHECK (kind IN ('adult', 'kids')),
  age            int CHECK (age BETWEEN 1 AND 17),
  max_rating     text NOT NULL DEFAULT '18' CHECK (max_rating IN ('all', '7', '12', '16', '18')),
  chat           boolean NOT NULL DEFAULT true,
  ask_to_buy     boolean NOT NULL DEFAULT false,
  screen_minutes int NOT NULL DEFAULT 0 CHECK (screen_minutes BETWEEN 0 AND 1440), -- 0 means no daily limit
  bedtime        text NOT NULL DEFAULT '' CHECK (bedtime = '' OR bedtime ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ai_filter      boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX profiles_account ON profiles (account_id, created_at);

CREATE TABLE profile_watch (
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  day        date NOT NULL,
  seconds    int NOT NULL DEFAULT 0 CHECK (seconds >= 0),
  PRIMARY KEY (profile_id, day)
);

CREATE TABLE kids_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  what        text NOT NULL CHECK (char_length(what) BETWEEN 1 AND 120),
  link        text NOT NULL DEFAULT '' CHECK (link = '' OR link ~ '^/[A-Za-z0-9/_?=&.%-]*$'),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz
);
CREATE INDEX kids_requests_open ON kids_requests (account_id, created_at DESC) WHERE status = 'pending';
