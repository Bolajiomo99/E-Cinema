-- Emergency pause (Studio / Live control room, Figma 37:1272): the studio can stop a premiere for
-- every viewer at once. While paused_at is set the picture holds; on resume the pause is added to
-- paused_ms (so everyone picks up where they stopped) and the running time grows to match.
ALTER TABLE showtimes ADD COLUMN paused_at timestamptz;
ALTER TABLE showtimes ADD COLUMN paused_ms bigint NOT NULL DEFAULT 0 CHECK (paused_ms >= 0);
