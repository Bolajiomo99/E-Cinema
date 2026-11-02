-- AI dubbing and subtitles (Figma 35:871): one row per film and language, then every line of it.
CREATE TABLE studio_dubs (
  upload       uuid NOT NULL REFERENCES studio_uploads(id) ON DELETE CASCADE,
  lang         text NOT NULL CHECK (lang ~ '^[a-z]{2,3}$'),
  status       text NOT NULL DEFAULT 'translating' CHECK (status IN ('translating', 'review', 'voicing', 'approved', 'failed')),
  voice        text NOT NULL DEFAULT 'ai' CHECK (voice IN ('ai', 'clone', 'actor')),
  lip_sync     boolean NOT NULL DEFAULT false,
  keep_music   boolean NOT NULL DEFAULT true,
  error        text NOT NULL DEFAULT '',
  approved_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (upload, lang)
);

CREATE TABLE studio_dub_lines (
  upload     uuid NOT NULL,
  lang       text NOT NULL,
  idx        integer NOT NULL CHECK (idx >= 0 AND idx < 5000),
  start_ms   integer NOT NULL CHECK (start_ms >= 0),
  end_ms     integer NOT NULL CHECK (end_ms >= start_ms),
  speaker    text NOT NULL DEFAULT '' CHECK (length(speaker) <= 40),
  source     text NOT NULL CHECK (length(source) <= 600),
  text       text NOT NULL CHECK (length(text) <= 600),
  flag       text NOT NULL DEFAULT '' CHECK (length(flag) <= 120),
  audio_key  text NOT NULL DEFAULT '',
  PRIMARY KEY (upload, lang, idx),
  FOREIGN KEY (upload, lang) REFERENCES studio_dubs(upload, lang) ON DELETE CASCADE
);
