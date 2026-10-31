-- Studios get 70% of each screening's ticket sales, paid by PayPal Payouts after the screening ends.
CREATE TABLE studios (
  name          text PRIMARY KEY,
  payout_email  text NOT NULL,
  share_bps     integer NOT NULL DEFAULT 7000 CHECK (share_bps BETWEEN 0 AND 10000)
);

INSERT INTO studios (name, payout_email) VALUES
  ('Lagoon Gate Pictures', 'payouts+lagoongate@e-cinema.net'),
  ('Hanbit Story House', 'payouts+hanbit@e-cinema.net');

-- One payout per screening. The row is claimed before PayPal is called, so a retry never pays twice.
CREATE TABLE studio_payouts (
  showtime_id      text PRIMARY KEY REFERENCES showtimes(id),
  studio           text NOT NULL REFERENCES studios(name),
  paid_seats       integer NOT NULL,
  gross_cents      bigint NOT NULL,
  studio_cents     bigint NOT NULL,
  currency         char(3) NOT NULL,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'nothing_due')),
  paypal_batch_id  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
