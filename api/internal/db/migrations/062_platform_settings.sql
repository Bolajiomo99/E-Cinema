-- Executive settings (Figma 83:386): platform-wide switches the CEO changes, each change logged.
CREATE TABLE platform_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_by  text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE settings_audit (
  id         bigserial PRIMARY KEY,
  actor      text NOT NULL,
  key        text NOT NULL,
  old_value  jsonb,
  new_value  jsonb NOT NULL,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX settings_audit_at ON settings_audit (at DESC);
