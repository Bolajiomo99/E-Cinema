-- Ticket funnel (Figma 39:678): who opened a film page and who played its trailer clip, one row per
-- visitor per film per day. The visitor is a salted hash made by the web server (account, or address
-- and browser for people not signed in), so nothing here identifies a person.
CREATE TABLE page_views (
  day         date NOT NULL,
  showtime_id text NOT NULL REFERENCES showtimes(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('page', 'clip')),
  visitor     text NOT NULL CHECK (visitor ~ '^[0-9a-f]{16,64}$'),
  country     text CHECK (country ~ '^[A-Z]{2}$'),
  PRIMARY KEY (day, showtime_id, kind, visitor)
);
CREATE INDEX page_views_showtime ON page_views (showtime_id, day);
