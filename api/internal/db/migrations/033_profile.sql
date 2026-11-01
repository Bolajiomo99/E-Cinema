-- Public profile (Figma "Web / Profile" 32:1060, "· Reviews" 95:1863, "· Badges" 95:2002).
-- City, a short line of interests and the languages someone speaks, all optional and shown to signed-in viewers.
ALTER TABLE accounts
  ADD COLUMN city      text CHECK (city IS NULL OR char_length(city) BETWEEN 1 AND 40),
  ADD COLUMN interests text CHECK (interests IS NULL OR char_length(interests) BETWEEN 1 AND 80),
  ADD COLUMN spoken    text[] NOT NULL DEFAULT '{}' CHECK (cardinality(spoken) <= 6);

-- Likes on a review, one per viewer. A review that is changed keeps its likes.
CREATE TABLE review_likes (
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  author_id   uuid NOT NULL,
  showtime_id text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, author_id, showtime_id),
  FOREIGN KEY (author_id, showtime_id) REFERENCES reviews (account_id, showtime_id) ON DELETE CASCADE
);
CREATE INDEX review_likes_review ON review_likes (author_id, showtime_id);
