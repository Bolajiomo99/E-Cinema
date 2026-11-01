// Package shop runs the E-Cinema store (Figma 53:925, 96:1194, 53:1111, 89:894): products,
// a cart per member, prices with member discounts, bundles, delivery and VAT, orders paid with
// PayPal or on delivery in Lagos, delivery tracking, returns and buyer reviews.
//
// Prices are kept in naira, the store's own currency. The web app converts them for display and
// tells the store what the payer was actually charged.
package shop

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound   = errors.New("not found")
	ErrBadInput   = errors.New("invalid request")
	ErrEmptyCart  = errors.New("your cart is empty")
	ErrNoAddress  = errors.New("add a delivery address first")
	ErrCantShip   = errors.New("some items cannot be delivered to this address")
	ErrNotLagos   = errors.New("pay on delivery is for Lagos addresses only")
	ErrTooLate    = errors.New("this order can no longer be changed")
	ErrNotBuyer   = errors.New("only people who received this item can review it")
	ErrPriceMoved = errors.New("prices changed while you were paying; please check your cart again")
)

const (
	MemberDiscount  = 0.05  // Pro, Student, VIP and Enterprise members
	BundleSaving    = 9000  // VR headset with the over-ear headset
	DeliveryNigeria = 2500  // anywhere in Nigeria
	DeliveryWorld   = 25000 // one parcel outside Nigeria
	ReturnDays      = 14
)

// VAT by delivery country, matching the plans checkout.
var vat = map[string]float64{"NG": 0.075, "DE": 0.19, "FR": 0.2, "NL": 0.21, "ES": 0.21, "IT": 0.22, "IE": 0.23, "BE": 0.21, "AT": 0.2, "PT": 0.23}

type Store struct{ DB *pgxpool.Pool }

type Option struct {
	Name   string   `json:"name"`
	Values []string `json:"values"`
}

type Product struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Sub        string   `json:"sub"`
	Category   string   `json:"category"`
	PriceNGN   int      `json:"priceNgn"`
	Blurb      string   `json:"blurb"`
	Options    []Option `json:"options"`
	Ships      string   `json:"ships"`
	BeforeShow bool     `json:"beforeShow"`
	ShipDays   int      `json:"shipDays"`
	Images     []string `json:"images"`
	Stars      float64  `json:"stars"`
	Reviews    int      `json:"reviews"`
}

const productCols = `p.id, p.name, p.sub, p.category, p.price_ngn, p.blurb, p.options, p.ships, p.before_show, p.ship_days, p.images,
  coalesce((SELECT round(avg(stars)::numeric, 1)::float8 FROM shop_reviews r WHERE r.product_id = p.id), 0),
  (SELECT count(*) FROM shop_reviews r WHERE r.product_id = p.id)::int`

func scanProduct(r pgx.Row) (Product, error) {
	var p Product
	var opts []byte
	err := r.Scan(&p.ID, &p.Name, &p.Sub, &p.Category, &p.PriceNGN, &p.Blurb, &opts, &p.Ships, &p.BeforeShow, &p.ShipDays, &p.Images, &p.Stars, &p.Reviews)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, ErrNotFound
	}
	if err == nil {
		err = json.Unmarshal(opts, &p.Options)
	}
	return p, err
}

// Products lists what is on sale, in shop order.
func (st Store) Products(ctx context.Context) ([]Product, error) {
	rows, err := st.DB.Query(ctx, `SELECT `+productCols+` FROM shop_products p WHERE p.active ORDER BY p.sort, p.id`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Product, error) { return scanProduct(r) })
}

func (st Store) Product(ctx context.Context, id string) (Product, error) {
	return scanProduct(st.DB.QueryRow(ctx, `SELECT `+productCols+` FROM shop_products p WHERE p.id = $1 AND p.active`, id))
}

type Review struct {
	Name      string    `json:"name"`
	Stars     int       `json:"stars"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"createdAt"`
}

func (st Store) Reviews(ctx context.Context, productID string) ([]Review, error) {
	rows, err := st.DB.Query(ctx, `SELECT a.name, r.stars, r.body, r.created_at FROM shop_reviews r JOIN accounts a ON a.id = r.account_id
	  WHERE r.product_id = $1 ORDER BY r.created_at DESC LIMIT 20`, productID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Review])
}

// validVariant checks a variant like "Black · 128 GB" against the product's options, in order.
func validVariant(p Product, variant string) (string, bool) {
	if len(p.Options) == 0 {
		return "", variant == ""
	}
	parts := strings.Split(variant, " · ")
	if len(parts) != len(p.Options) {
		return "", false
	}
	for i, o := range p.Options {
		ok := false
		for _, v := range o.Values {
			if v == strings.TrimSpace(parts[i]) {
				ok, parts[i] = true, v
			}
		}
		if !ok {
			return "", false
		}
	}
	return strings.Join(parts, " · "), true
}

// Line is one cart row with its product.
type Line struct {
	Product Product `json:"product"`
	Variant string  `json:"variant"`
	Qty     int     `json:"qty"`
	LineNGN int     `json:"lineNgn"`
}

func (st Store) Cart(ctx context.Context, accountID string) ([]Line, error) {
	rows, err := st.DB.Query(ctx, `SELECT `+productCols+`, c.variant, c.qty FROM shop_cart c JOIN shop_products p ON p.id = c.product_id
	  WHERE c.account_id = $1 AND p.active ORDER BY c.added_at, p.sort`, accountID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Line, error) {
		var l Line
		var opts []byte
		p := &l.Product
		err := r.Scan(&p.ID, &p.Name, &p.Sub, &p.Category, &p.PriceNGN, &p.Blurb, &opts, &p.Ships, &p.BeforeShow, &p.ShipDays, &p.Images, &p.Stars, &p.Reviews, &l.Variant, &l.Qty)
		if err == nil {
			err = json.Unmarshal(opts, &p.Options)
		}
		l.LineNGN = p.PriceNGN * l.Qty
		return l, err
	})
}

// SetQty puts a product in the cart, changes how many, or takes it out with qty 0.
// add=true adds to what is already there (the "Add to cart" button).
func (st Store) SetQty(ctx context.Context, accountID, productID, variant string, qty int, add bool) error {
	p, err := st.Product(ctx, productID)
	if err != nil {
		return err
	}
	if p.Ships == "digital" {
		return fmt.Errorf("%w: gift cards are sent from the gift page", ErrBadInput)
	}
	if variant == "" && add {
		// The bundle offer and quick adds take the first colour and size.
		parts := make([]string, len(p.Options))
		for i, o := range p.Options {
			parts[i] = o.Values[0]
		}
		variant = strings.Join(parts, " · ")
	}
	v, ok := validVariant(p, variant)
	if !ok {
		return fmt.Errorf("%w: pick %s", ErrBadInput, optionNames(p))
	}
	if qty < 0 || qty > 20 {
		return fmt.Errorf("%w: up to 20 of each item", ErrBadInput)
	}
	if qty == 0 && !add {
		_, err = st.DB.Exec(ctx, `DELETE FROM shop_cart WHERE account_id = $1 AND product_id = $2 AND variant = $3`, accountID, p.ID, v)
		return err
	}
	if add {
		_, err = st.DB.Exec(ctx, `INSERT INTO shop_cart (account_id, product_id, variant, qty) VALUES ($1, $2, $3, $4)
		  ON CONFLICT (account_id, product_id, variant) DO UPDATE SET qty = least(shop_cart.qty + EXCLUDED.qty, 20)`, accountID, p.ID, v, max(qty, 1))
		return err
	}
	_, err = st.DB.Exec(ctx, `INSERT INTO shop_cart (account_id, product_id, variant, qty) VALUES ($1, $2, $3, $4)
	  ON CONFLICT (account_id, product_id, variant) DO UPDATE SET qty = EXCLUDED.qty`, accountID, p.ID, v, qty)
	return err
}

func optionNames(p Product) string {
	n := make([]string, len(p.Options))
	for i, o := range p.Options {
		n[i] = strings.ToLower(o.Name)
	}
	return strings.Join(n, " and ")
}

type Address struct {
	Name    string `json:"name"`
	Phone   string `json:"phone"`
	Line1   string `json:"line1"`
	Area    string `json:"area"`
	City    string `json:"city"`
	State   string `json:"state"`
	Country string `json:"country"`
}

func (a Address) Lagos() bool {
	return a.Country == "NG" && (strings.EqualFold(strings.TrimSpace(a.City), "lagos") || strings.EqualFold(strings.TrimSpace(a.State), "lagos"))
}

func (st Store) Address(ctx context.Context, accountID string) (*Address, error) {
	var a Address
	err := st.DB.QueryRow(ctx, `SELECT name, phone, line1, area, city, state, country FROM shop_addresses WHERE account_id = $1`, accountID).
		Scan(&a.Name, &a.Phone, &a.Line1, &a.Area, &a.City, &a.State, &a.Country)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &a, err
}

func (st Store) SaveAddress(ctx context.Context, accountID string, a Address) (Address, error) {
	t := strings.TrimSpace
	a = Address{Name: t(a.Name), Phone: t(a.Phone), Line1: t(a.Line1), Area: t(a.Area), City: t(a.City), State: t(a.State), Country: strings.ToUpper(t(a.Country))}
	if len(a.Name) < 2 || len(a.Name) > 80 || len(a.Line1) < 3 || len(a.Line1) > 120 || len(a.City) < 2 || len(a.City) > 60 || len(a.Area) > 60 || len(a.State) > 60 {
		return a, fmt.Errorf("%w: add a name, street address and city", ErrBadInput)
	}
	digits := 0
	for _, r := range a.Phone {
		switch {
		case r >= '0' && r <= '9':
			digits++
		case strings.ContainsRune("+ -()", r):
		default:
			digits = -100
		}
	}
	if digits < 7 || len(a.Phone) > 20 {
		return a, fmt.Errorf("%w: add a phone number the rider can call", ErrBadInput)
	}
	if len(a.Country) != 2 || a.Country[0] < 'A' || a.Country[0] > 'Z' || a.Country[1] < 'A' || a.Country[1] > 'Z' {
		return a, fmt.Errorf("%w: pick a country", ErrBadInput)
	}
	_, err := st.DB.Exec(ctx, `INSERT INTO shop_addresses (account_id, name, phone, line1, area, city, state, country) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	  ON CONFLICT (account_id) DO UPDATE SET name = $2, phone = $3, line1 = $4, area = $5, city = $6, state = $7, country = $8, updated_at = now()`,
		accountID, a.Name, a.Phone, a.Line1, a.Area, a.City, a.State, a.Country)
	return a, err
}

// Show is the premiere snacks are timed for.
type Show struct {
	ID       string    `json:"id"`
	Film     string    `json:"film"`
	StartsAt time.Time `json:"startsAt"`
}

// NextShow is the member's next paid premiere, if any.
func (st Store) NextShow(ctx context.Context, accountID string) (*Show, error) {
	var s Show
	err := st.DB.QueryRow(ctx, `SELECT s.id, s.film, s.starts_at FROM holds h JOIN showtimes s ON s.id = h.showtime_id
	  WHERE h.account_id = $1 AND h.status = 'paid' AND s.starts_at > now() + interval '90 minutes' ORDER BY s.starts_at LIMIT 1`, accountID).
		Scan(&s.ID, &s.Film, &s.StartsAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &s, err
}

// Suggestion is the bundle offer under the cart.
type Suggestion struct {
	ProductID string `json:"productId"`
	Name      string `json:"name"`
	SaveNGN   int    `json:"saveNgn"`
}

type Quote struct {
	Lines       []Line      `json:"lines"`
	Count       int         `json:"count"`
	ItemsNGN    int         `json:"itemsNgn"`
	DiscountNGN int         `json:"discountNgn"`
	BundleNGN   int         `json:"bundleNgn"`
	DeliveryNGN int         `json:"deliveryNgn"`
	VATRate     float64     `json:"vatRate"`
	VATNGN      int         `json:"vatNgn"`
	TotalNGN    int         `json:"totalNgn"`
	Plan        string      `json:"plan"`
	Address     *Address    `json:"address"`
	NextShow    *Show       `json:"nextShow,omitempty"`
	Suggestion  *Suggestion `json:"suggestion,omitempty"`
	// Problems stop checkout: items that cannot go to this address.
	Problems []string `json:"problems"`
	// COD says whether pay on delivery is open for this address.
	COD bool `json:"cod"`
}

// Quote prices the member's cart for their saved address (or the browsing country before there is one).
func (st Store) Quote(ctx context.Context, accountID, country string) (Quote, error) {
	q := Quote{Problems: []string{}}
	var err error
	if q.Lines, err = st.Cart(ctx, accountID); err != nil {
		return q, err
	}
	if err = st.DB.QueryRow(ctx, `SELECT plan FROM accounts WHERE id = $1`, accountID).Scan(&q.Plan); err != nil {
		return q, err
	}
	if q.Address, err = st.Address(ctx, accountID); err != nil {
		return q, err
	}
	if q.NextShow, err = st.NextShow(ctx, accountID); err != nil {
		return q, err
	}
	if q.Address != nil {
		country = q.Address.Country
	}
	return price(q, country), nil
}

func price(q Quote, country string) Quote {
	has := map[string]bool{}
	physical := false
	for _, l := range q.Lines {
		q.Count += l.Qty
		q.ItemsNGN += l.LineNGN
		has[l.Product.ID] = true
		if l.Product.Ships != "digital" {
			physical = true
		}
		switch {
		case l.Product.Ships == "lagos" && q.Address != nil && !q.Address.Lagos():
			q.Problems = append(q.Problems, l.Product.Name+" is delivered same-day in Lagos only")
		case l.Product.Ships == "lagos" && q.Address == nil && country != "" && country != "NG":
			q.Problems = append(q.Problems, l.Product.Name+" is delivered same-day in Lagos only")
		case l.Product.Ships == "ng" && country != "" && country != "NG":
			q.Problems = append(q.Problems, l.Product.Name+" ships within Nigeria only")
		}
	}
	if q.Plan != "" && q.Plan != "free" {
		q.DiscountNGN = int(math.Round(float64(q.ItemsNGN) * MemberDiscount))
	}
	if has["vr-headset"] && has["over-ear-headset"] {
		q.BundleNGN = BundleSaving
	} else if has["vr-headset"] {
		q.Suggestion = &Suggestion{ProductID: "over-ear-headset", Name: "over-ear headset", SaveNGN: BundleSaving}
	}
	if physical {
		q.DeliveryNGN = DeliveryNigeria
		if country != "" && country != "NG" {
			q.DeliveryNGN = DeliveryWorld
		}
	}
	q.VATRate = vat[country]
	base := q.ItemsNGN - q.DiscountNGN - q.BundleNGN + q.DeliveryNGN
	q.VATNGN = int(math.Ceil(float64(base) * q.VATRate))
	q.TotalNGN = base + q.VATNGN
	q.COD = q.Address != nil && q.Address.Lagos()
	return q
}

type Item struct {
	ProductID  string     `json:"productId"`
	Name       string     `json:"name"`
	Variant    string     `json:"variant"`
	Qty        int        `json:"qty"`
	UnitNGN    int        `json:"unitNgn"`
	Images     []string   `json:"images"`
	ShipDays   int        `json:"shipDays"`
	BeforeShow bool       `json:"beforeShow"`
	ShowtimeID string     `json:"showtimeId,omitempty"`
	Film       string     `json:"film,omitempty"`
	StartsAt   *time.Time `json:"startsAt,omitempty"`
}

type Rider struct {
	Name    string `json:"name"`
	Phone   string `json:"phone"`
	Vehicle string `json:"vehicle"`
	Plate   string `json:"plate"`
	ETA     string `json:"eta"` // RFC 3339
}

type Order struct {
	ID             string     `json:"id"`
	Number         string     `json:"number"`
	AccountID      string     `json:"-"`
	Status         string     `json:"status"`
	Method         string     `json:"method"`
	ItemsNGN       int        `json:"itemsNgn"`
	DiscountNGN    int        `json:"discountNgn"`
	BundleNGN      int        `json:"bundleNgn"`
	DeliveryNGN    int        `json:"deliveryNgn"`
	VATNGN         int        `json:"vatNgn"`
	TotalNGN       int        `json:"totalNgn"`
	ChargeCurrency string     `json:"chargeCurrency"`
	ChargeCents    int        `json:"chargeCents"`
	Address        Address    `json:"address"`
	Rider          *Rider     `json:"rider,omitempty"`
	ReturnReason   string     `json:"returnReason,omitempty"`
	Buyer          string     `json:"buyer,omitempty"` // staff list only: the buyer's email
	CaptureID      string     `json:"-"`
	CreatedAt      time.Time  `json:"createdAt"`
	PlacedAt       *time.Time `json:"placedAt,omitempty"`
	PackedAt       *time.Time `json:"packedAt,omitempty"`
	OutAt          *time.Time `json:"outAt,omitempty"`
	DeliveredAt    *time.Time `json:"deliveredAt,omitempty"`
	CancelledAt    *time.Time `json:"cancelledAt,omitempty"`
	ReturnAt       *time.Time `json:"returnAt,omitempty"`
	ReturnedAt     *time.Time `json:"returnedAt,omitempty"`
	Items          []Item     `json:"items"`
}

// Placing an order: Method is paypal (with the PayPal order and what it charges) or cod.
type Placing struct {
	Method         string `json:"method"`
	Country        string `json:"country"`
	ExpectTotalNGN int    `json:"expectTotalNgn"`
	ChargeCurrency string `json:"chargeCurrency"`
	ChargeCents    int    `json:"chargeCents"`
	PayPalOrderID  string `json:"paypalOrderId"`
}

// Place turns the cart into an order. A pay-on-delivery order is placed straight away and the
// cart emptied; a PayPal order waits as pending until the capture confirms it.
func (st Store) Place(ctx context.Context, accountID string, p Placing) (Order, error) {
	q, err := st.Quote(ctx, accountID, p.Country)
	if err != nil {
		return Order{}, err
	}
	switch {
	case len(q.Lines) == 0:
		return Order{}, ErrEmptyCart
	case q.Address == nil:
		return Order{}, ErrNoAddress
	case len(q.Problems) > 0:
		return Order{}, fmt.Errorf("%w: %s", ErrCantShip, strings.Join(q.Problems, "; "))
	case p.ExpectTotalNGN != q.TotalNGN:
		return Order{}, ErrPriceMoved
	}
	var status string
	var paypalID *string
	switch p.Method {
	case "cod":
		if !q.COD {
			return Order{}, ErrNotLagos
		}
		status, p.ChargeCurrency, p.ChargeCents = "placed", "NGN", q.TotalNGN*100
	case "paypal":
		if p.PayPalOrderID == "" || p.ChargeCents <= 0 || len(p.ChargeCurrency) != 3 {
			return Order{}, fmt.Errorf("%w: missing payment", ErrBadInput)
		}
		status, paypalID = "pending", &p.PayPalOrderID
	default:
		return Order{}, fmt.Errorf("%w: choose how to pay", ErrBadInput)
	}
	addr, _ := json.Marshal(q.Address)
	tx, err := st.DB.Begin(ctx)
	if err != nil {
		return Order{}, err
	}
	defer tx.Rollback(ctx)
	var id string
	err = tx.QueryRow(ctx, `INSERT INTO shop_orders (account_id, status, method, items_ngn, discount_ngn, bundle_ngn, delivery_ngn, vat_ngn, total_ngn,
	    charge_currency, charge_cents, paypal_order_id, address, placed_at)
	  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CASE WHEN $2 = 'placed' THEN now() END) RETURNING id`,
		accountID, status, p.Method, q.ItemsNGN, q.DiscountNGN, q.BundleNGN, q.DeliveryNGN, q.VATNGN, q.TotalNGN,
		p.ChargeCurrency, p.ChargeCents, paypalID, addr).Scan(&id)
	if err != nil {
		return Order{}, err
	}
	for _, l := range q.Lines {
		var show *string
		if l.Product.BeforeShow && q.NextShow != nil {
			show = &q.NextShow.ID
		}
		if _, err = tx.Exec(ctx, `INSERT INTO shop_order_items (order_id, product_id, name, variant, qty, unit_ngn, showtime_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			id, l.Product.ID, l.Product.Name, l.Variant, l.Qty, l.Product.PriceNGN, show); err != nil {
			return Order{}, err
		}
	}
	if status == "placed" {
		if _, err = tx.Exec(ctx, `DELETE FROM shop_cart WHERE account_id = $1`, accountID); err != nil {
			return Order{}, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return Order{}, err
	}
	return st.order(ctx, `o.id = $1`, id)
}

// MarkPaid confirms a PayPal order: the order is placed and the cart emptied. It reports whether
// the PayPal order was a shop order, and returns it for the confirmation email.
func (st Store) MarkPaid(ctx context.Context, paypalOrderID, captureID string) (*Order, error) {
	var id, acct string
	err := st.DB.QueryRow(ctx, `UPDATE shop_orders SET status = 'placed', placed_at = coalesce(placed_at, now()), paypal_capture_id = $2
	  WHERE paypal_order_id = $1 AND (status = 'pending' OR paypal_capture_id = $2) RETURNING id, coalesce(account_id::text, '')`, paypalOrderID, captureID).Scan(&id, &acct)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	// Only what was bought leaves the cart; anything added since stays.
	if _, err = st.DB.Exec(ctx, `DELETE FROM shop_cart c USING shop_order_items i
	  WHERE i.order_id = $1 AND c.account_id = $2 AND c.product_id = i.product_id AND c.variant = i.variant`, id, acct); err != nil {
		return nil, err
	}
	o, err := st.order(ctx, `o.id = $1`, id)
	return &o, err
}

const orderCols = `o.id, o.number, coalesce(o.account_id::text, ''), o.status, o.method, o.items_ngn, o.discount_ngn, o.bundle_ngn, o.delivery_ngn, o.vat_ngn, o.total_ngn,
  o.charge_currency, o.charge_cents, o.address, o.rider, coalesce(o.return_reason, ''), coalesce(o.paypal_capture_id, ''), o.created_at,
  o.placed_at, o.packed_at, o.out_at, o.delivered_at, o.cancelled_at, o.return_at, o.returned_at`

func scanOrder(r pgx.Row) (Order, error) {
	var o Order
	var addr, rider []byte
	err := r.Scan(&o.ID, &o.Number, &o.AccountID, &o.Status, &o.Method, &o.ItemsNGN, &o.DiscountNGN, &o.BundleNGN, &o.DeliveryNGN, &o.VATNGN, &o.TotalNGN,
		&o.ChargeCurrency, &o.ChargeCents, &addr, &rider, &o.ReturnReason, &o.CaptureID, &o.CreatedAt,
		&o.PlacedAt, &o.PackedAt, &o.OutAt, &o.DeliveredAt, &o.CancelledAt, &o.ReturnAt, &o.ReturnedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return o, ErrNotFound
	}
	if err != nil {
		return o, err
	}
	if err = json.Unmarshal(addr, &o.Address); err != nil {
		return o, err
	}
	if len(rider) > 0 {
		o.Rider = &Rider{}
		err = json.Unmarshal(rider, o.Rider)
	}
	return o, err
}

func (st Store) items(ctx context.Context, orders []Order) error {
	if len(orders) == 0 {
		return nil
	}
	ids := make([]string, len(orders))
	at := map[string]int{}
	for i, o := range orders {
		ids[i], at[o.ID] = o.ID, i
		orders[i].Items = []Item{}
	}
	rows, err := st.DB.Query(ctx, `SELECT i.order_id, i.product_id, i.name, i.variant, i.qty, i.unit_ngn, p.images, p.ship_days, p.before_show,
	    coalesce(i.showtime_id, ''), coalesce(s.film, ''), s.starts_at
	  FROM shop_order_items i JOIN shop_products p ON p.id = i.product_id LEFT JOIN showtimes s ON s.id = i.showtime_id
	  WHERE i.order_id = ANY($1) ORDER BY p.before_show DESC, p.sort`, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var oid string
		var it Item
		if err := rows.Scan(&oid, &it.ProductID, &it.Name, &it.Variant, &it.Qty, &it.UnitNGN, &it.Images, &it.ShipDays, &it.BeforeShow, &it.ShowtimeID, &it.Film, &it.StartsAt); err != nil {
			return err
		}
		orders[at[oid]].Items = append(orders[at[oid]].Items, it)
	}
	return rows.Err()
}

func (st Store) order(ctx context.Context, where string, args ...any) (Order, error) {
	o, err := scanOrder(st.DB.QueryRow(ctx, `SELECT `+orderCols+` FROM shop_orders o WHERE `+where, args...))
	if err != nil {
		return o, err
	}
	list := []Order{o}
	err = st.items(ctx, list)
	return list[0], err
}

// Orders lists the member's orders, newest first, leaving out PayPal orders never paid.
func (st Store) Orders(ctx context.Context, accountID string) ([]Order, error) {
	rows, err := st.DB.Query(ctx, `SELECT `+orderCols+` FROM shop_orders o WHERE o.account_id = $1 AND o.status <> 'pending'
	  ORDER BY o.created_at DESC LIMIT 50`, accountID)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Order, error) { return scanOrder(r) })
	if err != nil {
		return nil, err
	}
	return list, st.items(ctx, list)
}

func (st Store) Mine(ctx context.Context, accountID, orderID string) (Order, error) {
	return st.order(ctx, `o.id = $1 AND o.account_id = $2 AND o.status <> 'pending'`, orderID, accountID)
}

// Cancel stops an order before it is packed. For a PayPal order it returns the capture to refund.
func (st Store) Cancel(ctx context.Context, accountID, orderID string) (Order, error) {
	var id string
	err := st.DB.QueryRow(ctx, `UPDATE shop_orders SET status = 'cancelled', cancelled_at = now()
	  WHERE id = $1 AND account_id = $2 AND status = 'placed' RETURNING id`, orderID, accountID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return Order{}, ErrTooLate
	}
	if err != nil {
		return Order{}, err
	}
	return st.order(ctx, `o.id = $1`, id)
}

// Return opens a return within 14 days of delivery.
func (st Store) Return(ctx context.Context, accountID, orderID, reason string) (Order, error) {
	reason = strings.TrimSpace(reason)
	if reason == "" || len(reason) > 300 {
		return Order{}, fmt.Errorf("%w: say why you are returning it", ErrBadInput)
	}
	var id string
	err := st.DB.QueryRow(ctx, `UPDATE shop_orders SET status = 'returning', return_at = now(), return_reason = $3
	  WHERE id = $1 AND account_id = $2 AND status = 'delivered' AND delivered_at > now() - make_interval(days => $4) RETURNING id`,
		orderID, accountID, reason, ReturnDays).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return Order{}, ErrTooLate
	}
	if err != nil {
		return Order{}, err
	}
	return st.order(ctx, `o.id = $1`, id)
}

// Reorder puts an earlier order's items back in the cart; items no longer sold are skipped.
func (st Store) Reorder(ctx context.Context, accountID, orderID string) (int, error) {
	tag, err := st.DB.Exec(ctx, `INSERT INTO shop_cart (account_id, product_id, variant, qty)
	  SELECT $2, i.product_id, i.variant, i.qty FROM shop_order_items i JOIN shop_orders o ON o.id = i.order_id JOIN shop_products p ON p.id = i.product_id
	  WHERE o.id = $1 AND o.account_id = $2 AND o.status <> 'pending' AND p.active
	  ON CONFLICT (account_id, product_id, variant) DO UPDATE SET qty = least(shop_cart.qty + EXCLUDED.qty, 20)`, orderID, accountID)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

// Advance is the delivery team moving an order along. It returns the updated order so the
// buyer's open pages can be told.
var nextStatus = map[string][]string{
	"placed":    {"packed", "cancelled"},
	"packed":    {"out", "cancelled"},
	"out":       {"delivered"},
	"returning": {"returned"},
}

func (st Store) Advance(ctx context.Context, number, status string, rider *Rider) (Order, error) {
	o, err := st.order(ctx, `o.number = $1`, number)
	if err != nil {
		return o, err
	}
	ok := false
	for _, s := range nextStatus[o.Status] {
		ok = ok || s == status
	}
	if !ok && !(status == o.Status && rider != nil) {
		return o, fmt.Errorf("%w: %s order cannot become %s", ErrBadInput, o.Status, status)
	}
	var r []byte
	if rider != nil {
		r, _ = json.Marshal(rider)
	}
	col := map[string]string{"packed": "packed_at", "out": "out_at", "delivered": "delivered_at", "cancelled": "cancelled_at", "returned": "returned_at"}[status]
	set := ""
	if col != "" && status != o.Status {
		set = ", " + col + " = now()"
	}
	if _, err = st.DB.Exec(ctx, `UPDATE shop_orders SET status = $2, rider = coalesce($3, rider)`+set+` WHERE id = $1`, o.ID, status, r); err != nil {
		return o, err
	}
	return st.order(ctx, `o.id = $1`, o.ID)
}

// Review lets someone who received a product rate it, once (a second review replaces the first).
func (st Store) Review(ctx context.Context, accountID, productID string, stars int, body string) error {
	body = strings.TrimSpace(body)
	if stars < 1 || stars > 5 || len(body) > 600 {
		return fmt.Errorf("%w: pick 1 to 5 stars", ErrBadInput)
	}
	var ok bool
	if err := st.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM shop_order_items i JOIN shop_orders o ON o.id = i.order_id
	  WHERE o.account_id = $1 AND i.product_id = $2 AND o.status IN ('delivered', 'returning', 'returned'))`, accountID, productID).Scan(&ok); err != nil {
		return err
	}
	if !ok {
		return ErrNotBuyer
	}
	_, err := st.DB.Exec(ctx, `INSERT INTO shop_reviews (product_id, account_id, stars, body) VALUES ($1, $2, $3, $4)
	  ON CONFLICT (product_id, account_id) DO UPDATE SET stars = $3, body = $4, created_at = now()`, productID, accountID, stars, body)
	return err
}

// Reviewable lists the products the member received and can review.
func (st Store) Reviewable(ctx context.Context, accountID string) ([]string, error) {
	rows, err := st.DB.Query(ctx, `SELECT DISTINCT i.product_id FROM shop_order_items i JOIN shop_orders o ON o.id = i.order_id
	  WHERE o.account_id = $1 AND o.status IN ('delivered', 'returning', 'returned')`, accountID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// Open lists orders the delivery team still has to move, oldest first.
func (st Store) Open(ctx context.Context) ([]Order, error) {
	rows, err := st.DB.Query(ctx, `SELECT `+orderCols+`, coalesce(a.email, '') FROM shop_orders o LEFT JOIN accounts a ON a.id = o.account_id
	  WHERE o.status IN ('placed', 'packed', 'out', 'returning') ORDER BY o.placed_at NULLS LAST, o.created_at LIMIT 200`)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Order, error) {
		var email string
		o, err := scanOrder(rowWithTail{r, &email})
		o.Buyer = email
		return o, err
	})
	if err != nil {
		return nil, err
	}
	return list, st.items(ctx, list)
}

// rowWithTail scans the order columns plus extra trailing columns.
type rowWithTail struct {
	pgx.Row
	tail *string
}

func (r rowWithTail) Scan(dest ...any) error { return r.Row.Scan(append(dest, r.tail)...) }
