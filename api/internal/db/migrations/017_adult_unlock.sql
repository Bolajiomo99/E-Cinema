-- 18+ unlock (Figma "Web / 18+ unlock · four payments", 28:839): an adult PIN, a one-time code
-- per stage, and three stage payments (charity, church, mosque funds) before the access fee,
-- which is the seat itself.
ALTER TABLE accounts ADD COLUMN adult_pin_hash text;
ALTER TABLE accounts ADD COLUMN adult_pin_set_at timestamptz;
ALTER TABLE accounts ADD COLUMN adult_pin_tries int NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN adult_pin_paused_until timestamptz;

ALTER TABLE auth_codes DROP CONSTRAINT auth_codes_purpose_check;
ALTER TABLE auth_codes ADD CONSTRAINT auth_codes_purpose_check CHECK (purpose IN ('login', 'reset', 'reset-token', 'lock', 'adult', 'adult-grant'));

CREATE TABLE adult_stages (
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  showtime_id       text NOT NULL REFERENCES showtimes(id),
  stage             int NOT NULL CHECK (stage BETWEEN 1 AND 3),
  fund              text NOT NULL CHECK (fund IN ('charity', 'church', 'mosque')),
  amount_cents      int NOT NULL CHECK (amount_cents > 0),
  currency          text NOT NULL,
  paypal_order_id   text NOT NULL UNIQUE,
  paypal_capture_id text UNIQUE,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  paid_at           timestamptz,
  PRIMARY KEY (account_id, showtime_id, stage)
);
