-- Infrastructure (Figma 50:469): every database copy the nightly backup job makes, and whether a test restore of it worked.
CREATE TABLE infra_backups (
  id           bigserial PRIMARY KEY,
  target       text NOT NULL CHECK (target IN ('r2')),
  object_key   text NOT NULL,
  bytes        bigint NOT NULL CHECK (bytes >= 0),
  tables       int NOT NULL DEFAULT 0,        -- tables found in the test restore
  restored     boolean NOT NULL DEFAULT false, -- the copy was restored into a scratch database and read back
  started_at   timestamptz NOT NULL,
  finished_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX infra_backups_recent ON infra_backups (finished_at DESC);
