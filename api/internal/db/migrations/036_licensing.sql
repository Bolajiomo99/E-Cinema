-- Licensed merch partners (Figma 114:1933 and the Licensee frames 116:38 to 116:726):
-- applications, the licence itself, the partner's team, products waiting for approval,
-- sales by channel, place and film, and the monthly royalty statements.
ALTER TABLE brand_licensees
  ADD COLUMN plan text NOT NULL DEFAULT 'growth' CHECK (plan IN ('starter', 'growth', 'global')),
  ADD COLUMN countries text[] NOT NULL DEFAULT '{NG}',
  ADD COLUMN valid_from date NOT NULL DEFAULT current_date,
  ADD COLUMN valid_until date NOT NULL DEFAULT (current_date + 365),
  ADD COLUMN payout_bank text NOT NULL DEFAULT '',
  ADD COLUMN payout_number text NOT NULL DEFAULT '',
  ADD COLUMN payout_name text NOT NULL DEFAULT '',
  ADD COLUMN payout_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN payout_hold_until timestamptz;

UPDATE brand_licensees SET countries = '{NG,GH,GB}', valid_from = '2025-12-28', valid_until = '2026-12-27' WHERE licence = 'NG-0042';
UPDATE brand_licensees SET plan = 'starter', countries = '{GB}' WHERE licence = 'GB-0007';
UPDATE brand_licensees SET plan = 'starter' WHERE licence = 'NG-0051';

CREATE SEQUENCE licence_number START 101;

CREATE TABLE licence_applications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  plan            text NOT NULL DEFAULT 'growth' CHECK (plan IN ('starter', 'growth', 'global')),
  company         text NOT NULL DEFAULT '',
  reg_number      text NOT NULL DEFAULT '',
  country         text NOT NULL DEFAULT 'NG',
  city            text NOT NULL DEFAULT '',
  website         text NOT NULL DEFAULT '',
  countries       text[] NOT NULL DEFAULT '{}',
  products        text NOT NULL DEFAULT '',
  doc_key         text NOT NULL DEFAULT '',
  doc_note        text NOT NULL DEFAULT '',
  doc_ok          boolean NOT NULL DEFAULT false,
  photos          text[] NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'active')),
  review_note     text NOT NULL DEFAULT '',
  fee_ngn         int NOT NULL DEFAULT 0,
  paypal_order_id text UNIQUE,
  paid_at         timestamptz,
  licence         text REFERENCES brand_licensees(licence),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE licence_members (
  licence     text NOT NULL REFERENCES brand_licensees(licence) ON DELETE CASCADE,
  email       text NOT NULL,
  account_id  uuid REFERENCES accounts(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'staff' CHECK (role IN ('owner', 'staff')),
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (licence, email)
);
CREATE INDEX licence_members_account ON licence_members (account_id);

CREATE TABLE licence_products (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  licence     text NOT NULL REFERENCES brand_licensees(licence) ON DELETE CASCADE,
  name        text NOT NULL,
  detail      text NOT NULL DEFAULT '',
  price_ngn   int NOT NULL DEFAULT 0 CHECK (price_ngn >= 0),
  film        text NOT NULL DEFAULT '',
  image_key   text NOT NULL DEFAULT '',
  sample_key  text NOT NULL DEFAULT '',
  checks      jsonb NOT NULL DEFAULT '[]',
  status      text NOT NULL DEFAULT 'review' CHECK (status IN ('review', 'live', 'changes', 'rejected')),
  note        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  live_at     timestamptz
);
CREATE INDEX licence_products_licence ON licence_products (licence, created_at DESC);

ALTER TABLE brand_codes ADD COLUMN product_id uuid REFERENCES licence_products(id) ON DELETE SET NULL;

CREATE TABLE licence_sales (
  id          bigserial PRIMARY KEY,
  licence     text NOT NULL REFERENCES brand_licensees(licence) ON DELETE CASCADE,
  product_id  uuid REFERENCES licence_products(id) ON DELETE SET NULL,
  product     text NOT NULL,
  channel     text NOT NULL CHECK (channel IN ('own', 'shop', 'stall', 'wholesale')),
  country     text NOT NULL DEFAULT 'NG',
  city        text NOT NULL DEFAULT '',
  qty         int NOT NULL CHECK (qty > 0),
  amount_ngn  bigint NOT NULL CHECK (amount_ngn >= 0),
  film        text NOT NULL DEFAULT '',
  sold_at     timestamptz NOT NULL DEFAULT now(),
  returned    boolean NOT NULL DEFAULT false,
  buyer       text NOT NULL DEFAULT '', -- a hashed buyer reference, for repeat-buyer counts
  ref         text UNIQUE
);
CREATE INDEX licence_sales_when ON licence_sales (licence, sold_at);

CREATE TABLE licence_settlements (
  licence     text NOT NULL REFERENCES brand_licensees(licence) ON DELETE CASCADE,
  month       date NOT NULL,
  settled_at  timestamptz NOT NULL DEFAULT now(),
  on_time     boolean NOT NULL DEFAULT true,
  PRIMARY KEY (licence, month)
);

-- Growth and Global partners' approved products appear in the E-Cinema shop; delivered shop
-- orders of them count as the partner's "E-Cinema shop" sales.
ALTER TABLE shop_products ADD COLUMN licence text REFERENCES brand_licensees(licence);

-- Deleting an account keeps its shop orders for the books but drops the link to the person
-- (the purge also trims the delivery address).
ALTER TABLE shop_orders ALTER COLUMN account_id DROP NOT NULL;
ALTER TABLE shop_orders DROP CONSTRAINT shop_orders_account_id_fkey;
ALTER TABLE shop_orders ADD CONSTRAINT shop_orders_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;
