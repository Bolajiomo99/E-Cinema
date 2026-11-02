-- Executive dashboards (Figma 07 Executive). The CEO comes from the CEO_EMAILS setting; everyone
-- else is granted a role here by the CEO.
CREATE TABLE executives (
  email       text PRIMARY KEY CHECK (email = lower(email) AND email LIKE '%@%'),
  role        text NOT NULL CHECK (role IN ('cfo', 'coo', 'cto', 'cmo', 'investor', 'partner', 'stakeholder')),
  added_by    uuid REFERENCES accounts(id) ON DELETE SET NULL,
  added_at    timestamptz NOT NULL DEFAULT now()
);
