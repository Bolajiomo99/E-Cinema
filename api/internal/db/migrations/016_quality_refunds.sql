-- Pre-order (Figma "Web / Pre-order", 52:958): how the viewer watches, and cancellations.
ALTER TABLE holds ADD COLUMN quality text NOT NULL DEFAULT 'hd' CHECK (quality IN ('hd', '4k', 'vr'));
ALTER TABLE holds ADD COLUMN paypal_refund_id text UNIQUE;
ALTER TABLE holds ADD COLUMN refunded_at timestamptz;
ALTER TABLE holds DROP CONSTRAINT holds_status_check;
ALTER TABLE holds ADD CONSTRAINT holds_status_check CHECK (status IN ('held', 'paid', 'released', 'refunded'));
