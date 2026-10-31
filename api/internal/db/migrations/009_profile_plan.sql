-- Sign-up details from Figma "Sign up · 1 Account" and the plan picked in "Sign up · 3 Plan".
ALTER TABLE accounts
  ADD COLUMN country        text CHECK (country ~ '^[A-Z]{2}$'),
  ADD COLUMN birth_date     date,
  ADD COLUMN gender         text,
  ADD COLUMN app_language   text,
  ADD COLUMN audio_language text,
  ADD COLUMN contact_phone  text,
  ADD COLUMN plan           text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'student', 'pro', 'vip', 'enterprise')),
  ADD COLUMN plan_status    text NOT NULL DEFAULT 'active' CHECK (plan_status IN ('active', 'awaiting_payment'));
