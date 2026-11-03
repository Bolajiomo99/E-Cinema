-- Partners view (Figma 51:198): what each partner's deal is, so they only see their own numbers.
CREATE TABLE partner_deals (
  email     text PRIMARY KEY REFERENCES executives(email) ON DELETE CASCADE ON UPDATE CASCADE,
  kind      text NOT NULL CHECK (kind IN ('payments', 'carrier', 'other')),
  provider  text NOT NULL DEFAULT '' CHECK (provider IN ('', 'paypal', 'paystack', 'flutterwave')),
  summary   text NOT NULL DEFAULT '' CHECK (length(summary) <= 200),
  plan      text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
