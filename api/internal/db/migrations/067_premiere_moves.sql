-- Rescheduling and withdrawing a premiere (Figma 99:247, Danger zone). A moved premiere lets its
-- ticket holders take a full refund for 7 days whatever the usual cancel window says; a withdrawn
-- premiere leaves the catalogue and every paid seat is queued for a refund.
ALTER TABLE showtimes ADD COLUMN withdrawn_at timestamptz;
ALTER TABLE showtimes ADD COLUMN moved_from timestamptz;
ALTER TABLE holds ADD COLUMN refund_until timestamptz;
ALTER TABLE holds ADD COLUMN refund_due boolean NOT NULL DEFAULT false;
CREATE INDEX holds_refund_due ON holds (showtime_id) WHERE refund_due;
