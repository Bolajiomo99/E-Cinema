package exec

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Shop and merch (Figma 51:657) and Add a product (83:631). Every product carries the E-Cinema
// mark; prices are kept in naira and the shop converts them for each viewer.

type ShopProduct struct {
	ID         string          `json:"id"`
	Name       string          `json:"name"`
	Sub        string          `json:"sub"`
	Blurb      string          `json:"blurb"`
	Category   string          `json:"category"`
	PriceNGN   int             `json:"priceNgn"`
	Options    json.RawMessage `json:"options"`
	Ships      string          `json:"ships"`
	ShipDays   int             `json:"shipDays"`
	BeforeShow bool            `json:"beforeShow"`
	Images     []string        `json:"images"`
	Active     bool            `json:"active"`
	Licence    string          `json:"licence"`
	Sold       int             `json:"sold"`
	RevenueNGN int64           `json:"revenueNgn"`
}

type ShopStats struct {
	Orders       int            `json:"orders"`
	OrdersPrev   int            `json:"ordersPrev"`
	RevenueNGN   int64          `json:"revenueNgn"`
	Delivered    int            `json:"delivered"`
	OnTime       int            `json:"onTime"`
	Destinations map[string]int `json:"destinations"`
	Products     []ShopProduct  `json:"products"`
	CanAdd       bool           `json:"canAdd"`
}

// CanAddProducts: the CEO, and cabinet members the CEO allowed to add merch and rooms.
func (st Store) CanAddProducts(ctx context.Context, email string) (bool, error) {
	if st.ceo(email) {
		return true, nil
	}
	var ok bool
	err := st.DB.QueryRow(ctx, `SELECT role IN ('cfo', 'coo', 'cto', 'cmo') AND can_add FROM executives WHERE email = lower($1)
	  AND NOT pending AND (expires_on IS NULL OR expires_on >= (now() AT TIME ZONE 'Africa/Lagos')::date)`, email).Scan(&ok)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	return ok, err
}

// Orders that count: paid by PayPal, or cash orders once delivered; never cancelled or returned.
const goodOrder = `placed_at IS NOT NULL AND cancelled_at IS NULL AND returned_at IS NULL AND (method = 'paypal' OR delivered_at IS NOT NULL)`

func (st Store) Shop(ctx context.Context, email string, now time.Time) (ShopStats, error) {
	s := ShopStats{Destinations: map[string]int{}, Products: []ShopProduct{}}
	if err := st.allowed(ctx, email, "coo", "cfo"); err != nil {
		return s, err
	}
	var err error
	if s.CanAdd, err = st.CanAddProducts(ctx, email); err != nil {
		return s, err
	}
	from := now.AddDate(0, 0, -30)
	if err := st.DB.QueryRow(ctx, `SELECT count(*) FILTER (WHERE placed_at >= $1)::int, count(*) FILTER (WHERE placed_at < $1)::int,
	    coalesce(sum(total_ngn) FILTER (WHERE placed_at >= $1), 0)::bigint FROM shop_orders WHERE `+goodOrder+` AND placed_at >= $1::timestamptz - interval '30 days'`, from).Scan(&s.Orders, &s.OrdersPrev, &s.RevenueNGN); err != nil {
		return s, err
	}
	// On time: delivered within the slowest item's delivery days (plus the day it was placed).
	if err := st.DB.QueryRow(ctx, `SELECT count(*)::int, count(*) FILTER (WHERE o.delivered_at <= o.placed_at + make_interval(days => 1 + coalesce(
	    (SELECT max(p.ship_days) FROM shop_order_items i JOIN shop_products p ON p.id = i.product_id WHERE i.order_id = o.id), 2)))::int
	  FROM shop_orders o WHERE o.delivered_at >= $1`, from).Scan(&s.Delivered, &s.OnTime); err != nil {
		return s, err
	}
	rows, err := st.DB.Query(ctx, `SELECT upper(coalesce(nullif(address->>'country', ''), 'NG')), count(*)::int FROM shop_orders WHERE `+goodOrder+` AND placed_at >= $1 GROUP BY 1`, from)
	if err != nil {
		return s, err
	}
	for rows.Next() {
		var cc string
		var n int
		if err := rows.Scan(&cc, &n); err != nil {
			rows.Close()
			return s, err
		}
		s.Destinations[cc] = n
	}
	rows.Close()
	rows, err = st.DB.Query(ctx, `SELECT p.id, p.name, p.sub, p.blurb, p.category, p.price_ngn, p.options, p.ships, p.ship_days, p.before_show, p.images, p.active, coalesce(p.licence, ''),
	    coalesce(sum(i.qty) FILTER (WHERE o.id IS NOT NULL), 0)::int, coalesce(sum(i.qty * i.unit_ngn) FILTER (WHERE o.id IS NOT NULL), 0)::bigint
	  FROM shop_products p LEFT JOIN shop_order_items i ON i.product_id = p.id
	  LEFT JOIN shop_orders o ON o.id = i.order_id AND o.placed_at >= $1 AND o.cancelled_at IS NULL AND o.returned_at IS NULL AND (o.method = 'paypal' OR o.delivered_at IS NOT NULL)
	  GROUP BY p.id ORDER BY p.active DESC, 15 DESC, p.sort, p.id`, from)
	if err != nil {
		return s, err
	}
	s.Products, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (ShopProduct, error) {
		var p ShopProduct
		return p, r.Scan(&p.ID, &p.Name, &p.Sub, &p.Blurb, &p.Category, &p.PriceNGN, &p.Options, &p.Ships, &p.ShipDays, &p.BeforeShow, &p.Images, &p.Active, &p.Licence, &p.Sold, &p.RevenueNGN)
	})
	return s, err
}

type ProductInput struct {
	ID         string   `json:"id"` // empty for a new product
	Name       string   `json:"name"`
	Sub        string   `json:"sub"`
	Blurb      string   `json:"blurb"`
	Category   string   `json:"category"`
	PriceNGN   int      `json:"priceNgn"`
	Options    []Option `json:"options"`
	Ships      string   `json:"ships"`
	ShipDays   int      `json:"shipDays"`
	BeforeShow bool     `json:"beforeShow"`
	Images     []string `json:"images"`
	Active     bool     `json:"active"`
}

type Option struct {
	Name   string   `json:"name"`
	Values []string `json:"values"`
}

var (
	slugBad  = regexp.MustCompile(`[^a-z0-9]+`)
	imageURL = regexp.MustCompile(`^/api/shop/photo/[0-9a-f-]{36}\.(jpg|png|webp)$`)
	cats     = map[string]bool{"gear": true, "clothing": true, "snacks": true, "accessories": true, "gift": true}
	ships    = map[string]bool{"world": true, "ng": true, "lagos": true, "digital": true}
)

// SaveProduct adds a product or changes one; it returns the product's id.
func (st Store) SaveProduct(ctx context.Context, email string, in ProductInput) (string, error) {
	ok, err := st.CanAddProducts(ctx, email)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", ErrForbidden
	}
	in.Name, in.Sub, in.Blurb = strings.TrimSpace(in.Name), strings.TrimSpace(in.Sub), strings.TrimSpace(in.Blurb)
	if len(in.Name) < 2 || len(in.Name) > 80 || len(in.Sub) > 120 || len(in.Blurb) > 1500 || !cats[in.Category] || !ships[in.Ships] ||
		in.PriceNGN < 100 || in.PriceNGN > 50_000_000 || in.ShipDays < 0 || in.ShipDays > 60 || len(in.Images) > 8 || len(in.Options) > 3 {
		return "", ErrBadInput
	}
	for _, u := range in.Images {
		if !imageURL.MatchString(u) {
			return "", ErrBadInput
		}
	}
	opts := []Option{}
	for _, o := range in.Options {
		o.Name = strings.TrimSpace(o.Name)
		vals := []string{}
		for _, v := range o.Values {
			if v = strings.TrimSpace(v); v != "" && len(v) <= 40 && len(vals) < 12 {
				vals = append(vals, v)
			}
		}
		if o.Name != "" && len(o.Name) <= 30 && len(vals) > 0 {
			opts = append(opts, Option{Name: o.Name, Values: vals})
		}
	}
	optJSON, _ := json.Marshal(opts)
	if in.ID == "" {
		base := strings.Trim(slugBad.ReplaceAllString(strings.ToLower(in.Name), "-"), "-")
		if len(base) > 50 {
			base = strings.Trim(base[:50], "-")
		}
		if base == "" {
			base = "product"
		}
		id := base
		for i := 2; ; i++ {
			var taken bool
			if err := st.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM shop_products WHERE id = $1)`, id).Scan(&taken); err != nil {
				return "", err
			}
			if !taken {
				break
			}
			id = base + "-" + itoa(i)
		}
		_, err = st.DB.Exec(ctx, `INSERT INTO shop_products (id, name, sub, category, price_ngn, blurb, options, ships, before_show, ship_days, images, sort, active)
		  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, (SELECT coalesce(max(sort), 0) + 1 FROM shop_products), $12)`,
			id, in.Name, in.Sub, in.Category, in.PriceNGN, in.Blurb, optJSON, in.Ships, in.BeforeShow, in.ShipDays, in.Images, in.Active)
		return id, err
	}
	// Licensee products are run from the licensing desk, not here.
	tag, err := st.DB.Exec(ctx, `UPDATE shop_products SET name = $2, sub = $3, category = $4, price_ngn = $5, blurb = $6, options = $7, ships = $8,
	    before_show = $9, ship_days = $10, images = $11, active = $12 WHERE id = $1 AND licence IS NULL`,
		in.ID, in.Name, in.Sub, in.Category, in.PriceNGN, in.Blurb, optJSON, in.Ships, in.BeforeShow, in.ShipDays, in.Images, in.Active)
	if err == nil && tag.RowsAffected() == 0 {
		return "", ErrNotFound
	}
	return in.ID, err
}

func itoa(i int) string {
	b := []byte{}
	for ; i > 0; i /= 10 {
		b = append([]byte{byte('0' + i%10)}, b...)
	}
	return string(b)
}
