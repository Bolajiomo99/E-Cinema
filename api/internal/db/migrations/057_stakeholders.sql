-- Stakeholder view (Figma 83:958): the CEO's monthly message and documents shared with stakeholders.
CREATE TABLE stakeholder_note (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  body        text NOT NULL DEFAULT '' CHECK (length(body) <= 1200),
  updated_by  text NOT NULL DEFAULT '',
  updated_at  timestamptz
);
INSERT INTO stakeholder_note (id) VALUES (1);

CREATE TABLE stakeholder_docs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  object_key  text NOT NULL UNIQUE CHECK (object_key ~ '^board/[0-9a-f-]{36}\.pdf$'),
  bytes       bigint NOT NULL CHECK (bytes > 0),
  shared_by   text NOT NULL,
  shared_at   timestamptz NOT NULL DEFAULT now()
);
