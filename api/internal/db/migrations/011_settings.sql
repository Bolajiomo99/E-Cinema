-- Settings (Figma "Web / Settings" frames 93:900, 33:781, 33:901, 93:1091, 93:1336, 93:1493, 93:1666, 96:1493).
ALTER TABLE accounts
  ADD COLUMN username            text UNIQUE CHECK (username ~ '^[a-z0-9._]{3,20}$'),
  ADD COLUMN password_changed_at timestamptz,
  ADD COLUMN two_step            boolean NOT NULL DEFAULT false,
  ADD COLUMN login_alerts        boolean NOT NULL DEFAULT true,
  ADD COLUMN prefs               jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN delete_after        timestamptz;
