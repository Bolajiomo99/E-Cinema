-- Studio notification emails (Figma 39:1184 Settings · Notifications): each member picks which
-- emails they get. Every kind is on until the member turns it off.
ALTER TABLE studio_members
  ADD COLUMN IF NOT EXISTS alerts text[] NOT NULL DEFAULT '{milestones,incidents,leaks,weekly}';
