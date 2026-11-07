-- Bank transfer payouts (Studio / Payouts, Figma 39:980): a studio can be paid into a bank account
-- through Flutterwave Transfers instead of PayPal. The bank code is Flutterwave's code for the bank.
ALTER TABLE studios ADD COLUMN payout_bank_code text NOT NULL DEFAULT '';
-- How each payout went out. transfer_id holds Flutterwave's transfer id while it is in flight;
-- attempts counts failed transfers so each retry uses a fresh reference.
ALTER TABLE studio_payouts ADD COLUMN method text NOT NULL DEFAULT 'paypal' CHECK (method IN ('paypal', 'bank'));
ALTER TABLE studio_payouts ADD COLUMN transfer_id text NOT NULL DEFAULT '';
ALTER TABLE studio_payouts ADD COLUMN attempts int NOT NULL DEFAULT 0;
ALTER TABLE studio_payouts ADD COLUMN paid_currency text NOT NULL DEFAULT '';
ALTER TABLE studio_payouts ADD COLUMN paid_minor bigint NOT NULL DEFAULT 0;
