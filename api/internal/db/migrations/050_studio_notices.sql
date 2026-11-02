-- Studio notifications (Figma 99:552) are worked out from what happened; each member keeps
-- when they last marked them read.
CREATE TABLE studio_notice_reads (
  studio      text NOT NULL REFERENCES studios(name) ON DELETE CASCADE ON UPDATE CASCADE,
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  seen_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (studio, account_id)
);
