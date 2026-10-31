-- Bring back a classic (Figma 31:1055, home 17:308): Pro and Enterprise members request older
-- films; at the goal the studio schedules a one-night screening.
CREATE TABLE classics (
  id           text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{3,60}$'),
  title        text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  year         integer CHECK (year BETWEEN 1900 AND 2100),
  from_vault   boolean NOT NULL DEFAULT false,
  goal         integer NOT NULL DEFAULT 500 CHECK (goal > 0),
  colors       text[] NOT NULL DEFAULT '{"#1b1b21","#0e0e12"}',
  showtime_id  text REFERENCES showtimes(id),
  suggested_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE classic_votes (
  classic_id text NOT NULL REFERENCES classics(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (classic_id, account_id)
);

-- Titles our studio partners have cleared from their vaults (invented names, like the catalog).
INSERT INTO classics (id, title, year, from_vault, colors) VALUES
  ('lagos-lights-2009', 'Lagos Lights', 2009, true, '{"#3b2a0a","#160f04"}'),
  ('harbour-kings-2012', 'Harbour Kings', 2012, true, '{"#3a0d12","#120406"}'),
  ('the-last-danfo-2004', 'The Last Danfo', 2004, true, '{"#0f3324","#06140e"}'),
  ('spring-in-busan-2011', 'Spring in Busan', 2011, true, '{"#1d1440","#0b0819"}'),
  ('market-day-1998', 'Market Day', 1998, true, '{"#3a2210","#140b05"}'),
  ('monsoon-letters-2006', 'Monsoon Letters', 2006, true, '{"#102a3a","#05121a"}')
ON CONFLICT (id) DO NOTHING;
