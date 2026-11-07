-- Studio settings "AI dub approval" (Figma 39:1042): when on (the default) every new dubbed
-- language waits for a person on the studio team to approve it. When off, a language whose
-- every line is voiced and nothing is flagged goes live as soon as voicing finishes.
ALTER TABLE studios ADD COLUMN dub_review boolean NOT NULL DEFAULT true;
