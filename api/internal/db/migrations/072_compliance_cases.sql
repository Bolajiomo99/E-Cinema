-- Email 43 (Figma 127:435): the brand team opens a compliance case when a market check finds a
-- partner breaking the rules. The partner has a set number of days to fix it, says when it is
-- fixed, and the brand team closes the case or suspends the licence.
CREATE TABLE licence_cases (
  id           serial PRIMARY KEY,
  licence      text NOT NULL REFERENCES brand_licensees(licence) ON DELETE CASCADE,
  issue        text NOT NULL,
  place        text NOT NULL DEFAULT '',
  finding      text NOT NULL,
  fix_by       date NOT NULL,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fixed', 'closed', 'suspended')),
  partner_note text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz
);
CREATE INDEX licence_cases_licence ON licence_cases (licence, created_at DESC);
