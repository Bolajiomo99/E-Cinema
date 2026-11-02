-- Access and roles (Figma 49:1307, 99:1041): what each executive may see and until when.
ALTER TABLE executives
  ADD COLUMN name       text NOT NULL DEFAULT '',
  ADD COLUMN org        text NOT NULL DEFAULT '',
  ADD COLUMN scopes     text[] NOT NULL DEFAULT '{}',
  ADD COLUMN can_add    boolean NOT NULL DEFAULT false,
  ADD COLUMN can_money  boolean NOT NULL DEFAULT false,
  ADD COLUMN watermark  boolean NOT NULL DEFAULT true,
  ADD COLUMN expires_on date;
