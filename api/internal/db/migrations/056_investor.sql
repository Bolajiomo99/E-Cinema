-- Investor view (Figma 50:609): milestones the CEO posts for investors. Nothing is seeded.
CREATE TABLE investor_milestones (
  id          bigserial PRIMARY KEY,
  quarter     text NOT NULL CHECK (quarter ~ '^Q[1-4] 20[0-9]{2}$'),
  title       text NOT NULL CHECK (length(title) BETWEEN 3 AND 140),
  done        boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
