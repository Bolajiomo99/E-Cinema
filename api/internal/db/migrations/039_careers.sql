-- Careers (Figma 94:1157, 114:1273, 114:1397, 114:1531): open roles, applications and their stages.
CREATE TABLE careers_settings (
  id        int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ng_share  int NOT NULL DEFAULT 40 CHECK (ng_share BETWEEN 0 AND 100) -- share of roles kept for Nigeria, set by the CEO
);
INSERT INTO careers_settings (id) VALUES (1);

CREATE TABLE jobs (
  slug        text PRIMARY KEY CHECK (slug ~ '^[a-z0-9-]{3,80}$'),
  title       text NOT NULL,
  team        text NOT NULL,
  city        text NOT NULL,
  country     text NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  remote      boolean NOT NULL DEFAULT false,
  kind        text NOT NULL CHECK (kind IN ('full', 'part', 'intern', 'shift')),
  quota       text NOT NULL CHECK (quota IN ('ng', 'world')),
  pay         text NOT NULL DEFAULT '',
  setup       text NOT NULL DEFAULT '', -- Hybrid, On site, Remote
  about       text NOT NULL,
  bring       text NOT NULL,
  open        boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_open ON jobs (created_at DESC) WHERE open;

CREATE TABLE job_applications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_slug      text NOT NULL REFERENCES jobs(slug) ON DELETE CASCADE,
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name          text NOT NULL,
  email         text NOT NULL,
  country       text NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  link          text NOT NULL DEFAULT '',
  cv_key        text NOT NULL,
  why           text NOT NULL DEFAULT '',
  keep          boolean NOT NULL DEFAULT false,
  ng_eligible   boolean NOT NULL DEFAULT false,
  stage         text NOT NULL DEFAULT 'received' CHECK (stage IN ('received', 'chat', 'task', 'team', 'offer', 'hired', 'closed')),
  message       text NOT NULL DEFAULT '',  -- what the team last told the applicant
  task_due      date,
  task_pay      text NOT NULL DEFAULT '',
  interview_at  timestamptz,
  interview_with text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_slug, account_id)
);
CREATE INDEX job_applications_open ON job_applications (updated_at DESC) WHERE stage NOT IN ('hired', 'closed');

CREATE TABLE job_application_events (
  application_id uuid NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,
  stage          text NOT NULL,
  at             timestamptz NOT NULL DEFAULT now(),
  detail         text NOT NULL DEFAULT ''
);
CREATE INDEX job_application_events_app ON job_application_events (application_id, at);

-- Group screening quote requests (Figma 94:1239 "Get a quote").
CREATE TABLE business_quotes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation text NOT NULL,
  email        text NOT NULL,
  guests       int NOT NULL CHECK (guests BETWEEN 2 AND 50000),
  country      text NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  kind         text NOT NULL DEFAULT '',
  note         text NOT NULL DEFAULT '',
  status       text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'won', 'lost')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
