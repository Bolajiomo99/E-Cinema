-- E-Cinema shop (Figma 53:925 shop, 96:1194 product, 53:1111 cart and checkout, 89:894 orders):
-- our own products, a cart per member, orders paid through PayPal or on delivery in Lagos,
-- delivery tracking set by the delivery team, returns within 14 days, and buyer reviews.
CREATE TABLE shop_products (
  id          text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{2,40}$'),
  name        text NOT NULL,
  sub         text NOT NULL DEFAULT '',
  category    text NOT NULL CHECK (category IN ('gear', 'clothing', 'snacks', 'accessories', 'gift')),
  price_ngn   integer NOT NULL CHECK (price_ngn > 0),
  blurb       text NOT NULL DEFAULT '',
  -- [{"name": "Colour", "values": ["Black", "White"]}], in the order they are picked.
  options     jsonb NOT NULL DEFAULT '[]',
  -- world: ships anywhere; ng: Nigeria only; lagos: same-day in Lagos only; digital: sent by email.
  ships       text NOT NULL DEFAULT 'world' CHECK (ships IN ('world', 'ng', 'lagos', 'digital')),
  -- Snacks and drinks arrive before the buyer's next premiere.
  before_show boolean NOT NULL DEFAULT false,
  ship_days   integer NOT NULL DEFAULT 2 CHECK (ship_days BETWEEN 0 AND 30),
  -- Photos uploaded to media storage; the shop draws product art until there are some.
  images      text[] NOT NULL DEFAULT '{}',
  sort        integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true
);

INSERT INTO shop_products (id, name, sub, category, price_ngn, blurb, options, ships, before_show, ship_days, sort) VALUES
  ('vr-headset', 'E-Cinema VR headset', 'Ships in 2 days', 'gear', 289000,
   'Front-row seat at every premiere. 4K per eye, spatial audio, 3 hours of battery, made for E‑Cinema VR halls.',
   '[{"name":"Colour","values":["Black","White"]},{"name":"Storage","values":["128 GB","256 GB"]}]', 'world', false, 2, 10),
  ('over-ear-headset', 'Over-ear headset', 'Noise cancelling', 'gear', 64000,
   'Closed-back, active noise cancelling, 30 hours per charge. Hear every line of the premiere and none of the generator.',
   '[{"name":"Colour","values":["Black","Silver"]}]', 'world', false, 2, 20),
  ('earbuds', 'Earbuds', 'Spatial audio', 'gear', 38500,
   'Spatial audio that follows the screen, 8 hours per charge and a case that tops them up four more times.',
   '[{"name":"Colour","values":["Black","White"]}]', 'world', false, 2, 30),
  ('power-bank', 'Power bank 20,000 mAh', 'Watch 3 films', 'accessories', 24000,
   'Enough for three full premieres on a phone, or one on a tablet. Fast charges over USB-C.',
   '[]', 'world', false, 2, 40),
  ('popcorn-box', 'Popcorn + drink box', 'Delivered before your premiere', 'snacks', 6500,
   'A big box of fresh popcorn and a chilled drink, delivered before your premiere starts.',
   '[{"name":"Popcorn","values":["Salted caramel","Butter","Chilli"]},{"name":"Drink","values":["Zobo","Chapman","Cola"]}]', 'lagos', true, 0, 50),
  ('logo-tshirt', 'Logo T-shirt', 'Sizes S to 3XL', 'clothing', 14000,
   'Soft cotton tee with the E-Cinema wordmark across the chest.',
   '[{"name":"Colour","values":["Black","White"]},{"name":"Size","values":["S","M","L","XL","2XL","3XL"]}]', 'world', false, 3, 60),
  ('premiere-cap', 'Premiere cap', '', 'clothing', 9500,
   'Six-panel cap with an embroidered screen arc. One size, adjustable strap.',
   '[{"name":"Colour","values":["Black","Red"]}]', 'world', false, 3, 70),
  ('tote-bag', 'Tote bag', '', 'accessories', 8000,
   'Heavy canvas tote, big enough for a laptop, snacks and a blanket for movie night.',
   '[]', 'world', false, 3, 80),
  ('umbrella', 'Umbrella', '', 'accessories', 11000,
   'Wind-proof, opens with one hand, folds small. Rainy season premieres sorted.',
   '[]', 'ng', false, 3, 90),
  ('table-water', 'Table water, 12 pack', 'Same-day in Lagos', 'snacks', 3600,
   'Twelve 75 cl bottles, delivered chilled the same day in Lagos.',
   '[]', 'lagos', true, 0, 100),
  ('strawberry-yoghurt', 'Strawberry yoghurt, 4 pack', 'Chilled · same-day in Lagos', 'snacks', 4800,
   'Four chilled strawberry yoghurts, kept cold all the way to your door.',
   '[]', 'lagos', true, 0, 110),
  ('premiere-hoodie', 'Premiere hoodie', 'Heavy cotton · S to 3XL', 'clothing', 28000,
   'Heavyweight cotton hoodie with the screen arc on the back. Cinema air-con proof.',
   '[{"name":"Colour","values":["Black","Grey"]},{"name":"Size","values":["S","M","L","XL","2XL","3XL"]}]', 'world', false, 3, 120),
  ('steel-bottle', 'Steel bottle 750 ml', 'Keeps drinks cold 24 hours', 'accessories', 11500,
   'Double-walled steel. Cold for 24 hours, hot for 12, and it does not sweat on the sofa.',
   '[{"name":"Colour","values":["Black","Red","White"]}]', 'world', false, 3, 130),
  ('popcorn-bucket', 'Collector popcorn bucket', 'Refills at partner cinemas', 'snacks', 9500,
   'A collector bucket with this season''s premieres printed around it.',
   '[]', 'world', false, 3, 140),
  ('gift-card', 'E‑Cinema gift card', 'Any amount, sent by email', 'gift', 5000,
   'Credit for tickets, plans and the shop, sent by email or WhatsApp with your message.',
   '[]', 'digital', false, 0, 150);

CREATE TABLE shop_cart (
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_id  text NOT NULL REFERENCES shop_products(id),
  variant     text NOT NULL DEFAULT '',
  qty         integer NOT NULL CHECK (qty BETWEEN 1 AND 20),
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, product_id, variant)
);

-- The member's delivery address, kept for next time.
CREATE TABLE shop_addresses (
  account_id  uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  phone       text NOT NULL CHECK (char_length(phone) BETWEEN 7 AND 20),
  line1       text NOT NULL CHECK (char_length(line1) BETWEEN 3 AND 120),
  area        text NOT NULL DEFAULT '' CHECK (char_length(area) <= 60),
  city        text NOT NULL CHECK (char_length(city) BETWEEN 2 AND 60),
  state       text NOT NULL DEFAULT '' CHECK (char_length(state) <= 60),
  country     char(2) NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE shop_order_number START 40001;

CREATE TABLE shop_orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number            text NOT NULL UNIQUE DEFAULT 'EC-' || nextval('shop_order_number'),
  account_id        uuid NOT NULL REFERENCES accounts(id),
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'placed', 'packed', 'out', 'delivered', 'cancelled', 'returning', 'returned')),
  method            text NOT NULL CHECK (method IN ('paypal', 'cod')),
  items_ngn         integer NOT NULL,
  discount_ngn      integer NOT NULL DEFAULT 0,
  bundle_ngn        integer NOT NULL DEFAULT 0,
  delivery_ngn      integer NOT NULL DEFAULT 0,
  vat_ngn           integer NOT NULL DEFAULT 0,
  total_ngn         integer NOT NULL,
  -- What the payer was actually charged (PayPal cannot charge naira).
  charge_currency   char(3) NOT NULL,
  charge_cents      integer NOT NULL,
  paypal_order_id   text UNIQUE,
  paypal_capture_id text UNIQUE,
  address           jsonb NOT NULL,
  -- Set by the delivery team: {"name","phone","vehicle","plate","eta"}.
  rider             jsonb,
  return_reason     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  placed_at         timestamptz,
  packed_at         timestamptz,
  out_at            timestamptz,
  delivered_at      timestamptz,
  cancelled_at      timestamptz,
  return_at         timestamptz,
  returned_at       timestamptz
);
CREATE INDEX shop_orders_account ON shop_orders (account_id, created_at DESC);

CREATE TABLE shop_order_items (
  order_id    uuid NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  product_id  text NOT NULL REFERENCES shop_products(id),
  name        text NOT NULL,
  variant     text NOT NULL DEFAULT '',
  qty         integer NOT NULL CHECK (qty > 0),
  unit_ngn    integer NOT NULL,
  -- For snacks: the premiere they should arrive before.
  showtime_id text REFERENCES showtimes(id),
  PRIMARY KEY (order_id, product_id, variant)
);

CREATE TABLE shop_reviews (
  product_id  text NOT NULL REFERENCES shop_products(id),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  stars       smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  body        text NOT NULL DEFAULT '' CHECK (char_length(body) <= 600),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, account_id)
);
