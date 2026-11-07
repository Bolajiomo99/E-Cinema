-- Studio settings "Default territories" (Figma 39:1032): countries where none of the studio's
-- films may be sold, for example where it does not hold the rights. Empty means worldwide.
ALTER TABLE studios ADD COLUMN blocked_countries text[] NOT NULL DEFAULT '{}'
  CHECK (cardinality(blocked_countries) <= 250);
