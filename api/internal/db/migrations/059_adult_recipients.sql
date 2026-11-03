-- 18+ recipients (Figma 49:1577, 99:1362): the charities, church pastors and mosque clerics a viewer
-- can pick for each of the first three 18+ unlock payments. Only the CEO adds, pauses or removes them.
CREATE TABLE adult_recipients (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL CHECK (kind IN ('charity', 'pastor', 'cleric')),
  name         text NOT NULL CHECK (length(name) BETWEEN 3 AND 120),
  reg_number   text NOT NULL DEFAULT '' CHECK (length(reg_number) <= 60),
  country      text NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  city         text NOT NULL DEFAULT '' CHECK (length(city) <= 80),
  bank         text NOT NULL DEFAULT '' CHECK (length(bank) <= 80),
  account_no   text NOT NULL DEFAULT '' CHECK (account_no ~ '^[0-9]{0,20}$'),
  account_name text NOT NULL DEFAULT '' CHECK (length(account_name) <= 120), -- as the bank reports it
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'paused')),
  note         text NOT NULL DEFAULT '' CHECK (length(note) <= 300),
  added_by     text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX adult_recipients_live ON adult_recipients (kind, status);
ALTER TABLE adult_stages ADD COLUMN recipient_id uuid REFERENCES adult_recipients(id) ON DELETE SET NULL;
