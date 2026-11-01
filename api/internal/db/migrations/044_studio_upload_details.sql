-- Film details for a studio's draft (Figma 99:247 "Film detail"): what viewers will read.
ALTER TABLE studio_uploads
  ADD COLUMN logline     text NOT NULL DEFAULT '' CHECK (length(logline) <= 300),
  ADD COLUMN genres      text NOT NULL DEFAULT '' CHECK (length(genres) <= 80),
  ADD COLUMN age_rating  text NOT NULL DEFAULT '' CHECK (length(age_rating) <= 60),
  ADD COLUMN cast_crew   text NOT NULL DEFAULT '' CHECK (length(cast_crew) <= 400),
  ADD COLUMN languages   text NOT NULL DEFAULT '' CHECK (length(languages) <= 80),
  ADD COLUMN poster_key  text NOT NULL DEFAULT '';
