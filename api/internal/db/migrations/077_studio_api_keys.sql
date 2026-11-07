-- Studio API keys (Figma 39:1073 "API keys"): read-only access to a studio's own films, sales
-- and payouts from its own systems. Only a hash of each key is kept.
CREATE TABLE studio_api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio       text NOT NULL REFERENCES studios(name) ON DELETE CASCADE ON UPDATE CASCADE,
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  prefix       text NOT NULL,
  hash         text NOT NULL UNIQUE,
  created_by   uuid REFERENCES accounts(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX studio_api_keys_studio ON studio_api_keys (studio);
