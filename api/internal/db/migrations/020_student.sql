-- Student offer (Figma "Web / Student offer", 94:1327): Student Pro needs a verified student,
-- checked once a year by a code sent to a school email, or by a photo of a student ID.
ALTER TABLE accounts
  ADD COLUMN student_school text,
  ADD COLUMN student_pending_email text,
  ADD COLUMN student_email text,
  ADD COLUMN student_method text CHECK (student_method IN ('email', 'id')),
  ADD COLUMN student_verified_until timestamptz;
-- One school email proves one student.
CREATE UNIQUE INDEX accounts_student_email ON accounts (student_email) WHERE student_email IS NOT NULL;

ALTER TABLE auth_codes DROP CONSTRAINT auth_codes_purpose_check;
ALTER TABLE auth_codes ADD CONSTRAINT auth_codes_purpose_check CHECK (purpose IN ('login', 'reset', 'reset-token', 'lock', 'adult', 'adult-grant', 'student'));
