-- Downloads (Figma "Web / Downloads" 31:743). Only films the viewer kept can be downloaded.
-- The file is encrypted on the device with a key that never leaves it; this licence decides
-- whether it may still play (30 days, renewed whenever the device comes back online).
CREATE TABLE download_licenses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  showtime_id text NOT NULL REFERENCES showtimes(id),
  device      text NOT NULL CHECK (device ~ '^[a-z0-9]{16,40}$'),
  quality     text NOT NULL CHECK (quality IN ('sd', 'hd')),
  size_bytes  bigint NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  audio       text[] NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz
);
CREATE UNIQUE INDEX download_licenses_live ON download_licenses (account_id, showtime_id, device) WHERE revoked_at IS NULL;
CREATE INDEX download_licenses_account ON download_licenses (account_id, created_at DESC);
