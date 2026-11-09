-- Translation memory: every piece of site, email and receipt text translated into a visitor's
-- language, so each string is translated once and then served from here.
CREATE TABLE translations (
  lang        text NOT NULL CHECK (lang ~ '^[a-z]{2,3}(-[A-Za-z]{2,4})?$'),
  src_hash    text NOT NULL,          -- sha256 of the English text, hex, first 32 chars
  src         text NOT NULL,
  text        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lang, src_hash)
);
