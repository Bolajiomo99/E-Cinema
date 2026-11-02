-- Marketing (Figma 39:779): tracked campaign links, the seats each one sold, and the clip
-- moments Studio AI picks from a film's subtitles.
CREATE TABLE studio_campaigns (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio       text NOT NULL REFERENCES studios(name) ON DELETE CASCADE ON UPDATE CASCADE,
  showtime_id  text NOT NULL REFERENCES showtimes(id),
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  channel      text NOT NULL CHECK (channel IN ('clips', 'tiktok', 'instagram', 'youtube', 'x', 'facebook', 'whatsapp', 'email', 'creator', 'other')),
  code         text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9]{8}$'),
  cost_cents   bigint NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
  clicks       integer NOT NULL DEFAULT 0,
  created_by   uuid REFERENCES accounts(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX studio_campaigns_studio ON studio_campaigns (studio, created_at DESC);
ALTER TABLE holds ADD COLUMN campaign_id uuid REFERENCES studio_campaigns(id) ON DELETE SET NULL;
CREATE INDEX holds_campaign ON holds (campaign_id) WHERE campaign_id IS NOT NULL;

ALTER TABLE studio_uploads ADD COLUMN clip_cutoff_ms integer NOT NULL DEFAULT 3000000 CHECK (clip_cutoff_ms >= 0);
CREATE TABLE studio_clips (
  upload     uuid NOT NULL REFERENCES studio_uploads(id) ON DELETE CASCADE,
  idx        integer NOT NULL CHECK (idx BETWEEN 0 AND 11),
  start_ms   integer NOT NULL CHECK (start_ms >= 0),
  end_ms     integer NOT NULL,
  title      text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 40),
  why        text NOT NULL DEFAULT '' CHECK (char_length(why) <= 200),
  format     text NOT NULL CHECK (format IN ('9:16', '1:1', '16:9')),
  approved   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (upload, idx),
  CHECK (end_ms > start_ms AND end_ms - start_ms <= 60000)
);
