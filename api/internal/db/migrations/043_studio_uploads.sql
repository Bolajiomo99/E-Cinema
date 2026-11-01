-- Film uploads from studios (Figma 35:290 "Upload · film file"). Each draft holds the files a
-- studio sends: the master, audio stems, subtitles and a trailer. Bytes go straight from the
-- browser to private storage in parts, so a 2 TB master can resume after a dropped connection.
CREATE TABLE studio_uploads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio      text NOT NULL REFERENCES studios(name) ON DELETE CASCADE ON UPDATE CASCADE,
  title       text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  created_by  uuid REFERENCES accounts(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX studio_uploads_studio ON studio_uploads (studio, updated_at DESC);

CREATE TABLE studio_upload_files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id     uuid NOT NULL REFERENCES studio_uploads(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('master', 'stems', 'subtitles', 'trailer', 'package')),
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  size_bytes    bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 2199023255552),
  content_type  text NOT NULL DEFAULT 'application/octet-stream',
  key           text NOT NULL UNIQUE,
  mp_id         text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'uploaded', 'failed')),
  info          text NOT NULL DEFAULT '',
  checks        jsonb NOT NULL DEFAULT '[]',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX studio_upload_files_upload ON studio_upload_files (upload_id, created_at);
