-- Coming-soon posts (Figma 53:1512): a studio announces a film ahead of release and sells
-- early seats at a lower price before the full film is uploaded.
ALTER TABLE studio_premieres
  ADD COLUMN coming_soon boolean NOT NULL DEFAULT false,
  ADD COLUMN early_save smallint NOT NULL DEFAULT 0 CHECK (early_save BETWEEN 0 AND 60),
  ADD COLUMN formats text[] NOT NULL DEFAULT '{hd}';
