package licensing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// ---- Products and approvals (Figma 116:300) ----

// Check is one line of the brand rules check run before a person reviews the product.
type Check struct {
	Name   string `json:"name"`
	Detail string `json:"detail"`
	Result string `json:"result"` // pass, fail, needed
}

type Product struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Detail    string     `json:"detail"`
	PriceNGN  int        `json:"priceNgn"`
	Film      string     `json:"film"`
	ImageKey  string     `json:"imageKey"`
	SampleKey string     `json:"sampleKey"`
	Checks    []Check    `json:"checks"`
	Status    string     `json:"status"`
	Note      string     `json:"note"`
	CreatedAt time.Time  `json:"createdAt"`
	LiveAt    *time.Time `json:"liveAt,omitempty"`
	Sold      int        `json:"sold"`
	Licence   string     `json:"licence,omitempty"`
	Partner   string     `json:"partner,omitempty"`
}

const productCols = `p.id, p.name, p.detail, p.price_ngn, p.film, p.image_key, p.sample_key, p.checks, p.status, p.note, p.created_at, p.live_at,
  coalesce((SELECT sum(qty) FROM licence_sales s WHERE s.product_id = p.id AND NOT s.returned), 0), p.licence`

func scanProduct(r pgx.Row, extra ...any) (Product, error) {
	var p Product
	var checks []byte
	err := r.Scan(append([]any{&p.ID, &p.Name, &p.Detail, &p.PriceNGN, &p.Film, &p.ImageKey, &p.SampleKey, &checks, &p.Status, &p.Note, &p.CreatedAt, &p.LiveAt, &p.Sold, &p.Licence}, extra...)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, ErrNotFound
	}
	if err == nil {
		err = json.Unmarshal(checks, &p.Checks)
	}
	return p, err
}

func (st Store) Products(ctx context.Context, licence string) ([]Product, error) {
	rows, err := st.DB.Query(ctx, `SELECT `+productCols+` FROM licence_products p WHERE p.licence = $1 ORDER BY p.status = 'live' DESC, p.created_at DESC`, licence)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Product, error) { return scanProduct(r) })
}

type NewProduct struct {
	Name     string  `json:"name"`
	Detail   string  `json:"detail"`
	PriceNGN int     `json:"priceNgn"`
	Film     string  `json:"film"`
	ImageKey string  `json:"imageKey"`
	Checks   []Check `json:"checks"`
}

func checksJSON(c []Check) []byte {
	if c == nil {
		c = []Check{}
	}
	for i := range c {
		c[i].Name, c[i].Detail = clip(c[i].Name, 60), clip(c[i].Detail, 200)
		if c[i].Result != "pass" && c[i].Result != "fail" {
			c[i].Result = "needed"
		}
	}
	b, _ := json.Marshal(c)
	return b
}

// AddProduct sends a new product design for approval, within the plan's product limit.
func (st Store) AddProduct(ctx context.Context, l Licensee, n NewProduct) (Product, error) {
	if clip(n.Name, 80) == "" || n.PriceNGN < 100 || n.PriceNGN > 5_000_000 {
		return Product{}, fmt.Errorf("%w: add a name and a price", ErrBadInput)
	}
	if !keyRe.MatchString(n.ImageKey) || strings.HasSuffix(n.ImageKey, ".pdf") {
		return Product{}, fmt.Errorf("%w: add a picture of the design", ErrBadInput)
	}
	if l.Plan.MaxProducts > 0 {
		var used int
		if err := st.DB.QueryRow(ctx, `SELECT count(*) FROM licence_products WHERE licence = $1 AND status <> 'rejected'`, l.Licence).Scan(&used); err != nil {
			return Product{}, err
		}
		if used >= l.Plan.MaxProducts {
			return Product{}, fmt.Errorf("%w: the %s plan allows %d products", ErrLimit, l.Plan.Name, l.Plan.MaxProducts)
		}
	}
	var id string
	if err := st.DB.QueryRow(ctx, `INSERT INTO licence_products (licence, name, detail, price_ngn, film, image_key, checks) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
		l.Licence, clip(n.Name, 80), clip(n.Detail, 200), n.PriceNGN, clip(n.Film, 80), n.ImageKey, checksJSON(n.Checks)).Scan(&id); err != nil {
		return Product{}, err
	}
	return st.product(ctx, l.Licence, id)
}

func (st Store) product(ctx context.Context, licence, id string) (Product, error) {
	return scanProduct(st.DB.QueryRow(ctx, `SELECT `+productCols+` FROM licence_products p WHERE p.id = $1 AND ($2 = '' OR p.licence = $2)`, id, licence))
}

// Resubmit replaces the design or adds the printed sample photo, and sends it back for review.
func (st Store) Resubmit(ctx context.Context, l Licensee, id, imageKey, sampleKey string, checks []Check) (Product, error) {
	p, err := st.product(ctx, l.Licence, id)
	if err != nil {
		return p, err
	}
	if p.Status == "rejected" {
		return p, ErrState
	}
	for _, k := range []string{imageKey, sampleKey} {
		if k != "" && (!keyRe.MatchString(k) || strings.HasSuffix(k, ".pdf")) {
			return p, fmt.Errorf("%w: picture", ErrBadInput)
		}
	}
	if imageKey == "" && sampleKey == "" {
		return p, fmt.Errorf("%w: add a new picture or a sample photo", ErrBadInput)
	}
	if imageKey != "" {
		p.ImageKey = imageKey
	}
	if sampleKey != "" {
		p.SampleKey = sampleKey
	}
	if checks == nil {
		checks = p.Checks
	}
	status := p.Status
	if status != "live" || imageKey != "" {
		status = "review"
	}
	if _, err := st.DB.Exec(ctx, `UPDATE licence_products SET image_key = $2, sample_key = $3, checks = $4, status = $5 WHERE id = $1`, id, p.ImageKey, p.SampleKey, checksJSON(checks), status); err != nil {
		return p, err
	}
	return st.product(ctx, l.Licence, id)
}

// ProductQueue is the brand team's list of designs to review.
func (st Store) ProductQueue(ctx context.Context) ([]Product, error) {
	rows, err := st.DB.Query(ctx, `SELECT `+productCols+`, b.name FROM licence_products p JOIN brand_licensees b USING (licence)
	  WHERE p.status = 'review' ORDER BY p.created_at`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Product, error) {
		var partner string
		p, err := scanProduct(r, &partner)
		p.Partner = partner
		return p, err
	})
}

// DecideProduct records the brand team's decision. Approved products of Growth and Global
// partners go on sale in the E-Cinema shop.
func (st Store) DecideProduct(ctx context.Context, id, status, note string) (Product, error) {
	if status != "live" && status != "changes" && status != "rejected" {
		return Product{}, fmt.Errorf("%w: status", ErrBadInput)
	}
	if status != "live" && clip(note, 200) == "" {
		return Product{}, fmt.Errorf("%w: say what needs changing", ErrBadInput)
	}
	var p Product
	err := pgx.BeginFunc(ctx, st.DB, func(tx pgx.Tx) error {
		var plan, licence string
		var price int
		var name, detail string
		err := tx.QueryRow(ctx, `UPDATE licence_products p SET status = $2, note = $3, live_at = CASE WHEN $2 = 'live' THEN coalesce(live_at, now()) END
		  FROM brand_licensees b WHERE p.id = $1 AND b.licence = p.licence RETURNING b.plan, p.licence, p.price_ngn, p.name, p.detail`, id, status, clip(note, 200)).
			Scan(&plan, &licence, &price, &name, &detail)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		shopID := "lp-" + strings.ReplaceAll(id, "-", "")[:12]
		if status == "live" && Plans[plan].InShop {
			_, err = tx.Exec(ctx, `INSERT INTO shop_products (id, name, sub, category, price_ngn, blurb, ships, ship_days, sort, licence)
			  VALUES ($1, $2, 'Licensed partner', 'clothing', $3, $4, 'ng', 3, 500, $5)
			  ON CONFLICT (id) DO UPDATE SET name = $2, price_ngn = $3, blurb = $4, active = true`, shopID, name, price, detail, licence)
		} else if status != "live" {
			_, err = tx.Exec(ctx, `UPDATE shop_products SET active = false WHERE id = $1`, shopID)
		}
		return err
	})
	if err != nil {
		return p, err
	}
	return st.product(ctx, "", id)
}

// ---- Sales ----

type Sale struct {
	ProductID string    `json:"productId"`
	Product   string    `json:"product"`
	Channel   string    `json:"channel"`
	Country   string    `json:"country"`
	City      string    `json:"city"`
	Qty       int       `json:"qty"`
	AmountNGN int64     `json:"amountNgn"`
	Film      string    `json:"film"`
	SoldAt    time.Time `json:"soldAt"`
	Buyer     string    `json:"buyer"`
	Ref       string    `json:"ref"`
}

// AddSales records the partner's own sales (typed in or from a spreadsheet). E-Cinema shop
// sales are recorded by the shop itself.
func (st Store) AddSales(ctx context.Context, l Licensee, list []Sale) (int, error) {
	if len(list) == 0 || len(list) > 2000 {
		return 0, fmt.Errorf("%w: 1 to 2,000 sales at a time", ErrBadInput)
	}
	products, err := st.Products(ctx, l.Licence)
	if err != nil {
		return 0, err
	}
	byID, byName := map[string]Product{}, map[string]Product{}
	for _, p := range products {
		byID[p.ID] = p
		byName[strings.ToLower(p.Name)] = p
	}
	allowed := map[string]bool{}
	for _, c := range l.Countries {
		allowed[c] = true
	}
	added := 0
	err = pgx.BeginFunc(ctx, st.DB, func(tx pgx.Tx) error {
		for i, s := range list {
			p, ok := byID[s.ProductID]
			if !ok {
				p, ok = byName[strings.ToLower(strings.TrimSpace(s.Product))]
			}
			row := fmt.Sprintf("row %d: ", i+1)
			if !ok || p.Status != "live" {
				return fmt.Errorf("%w: %sthe product must be one of your approved products", ErrBadInput, row)
			}
			if s.Channel != "own" && s.Channel != "stall" && s.Channel != "wholesale" {
				return fmt.Errorf("%w: %schannel must be own, stall or wholesale", ErrBadInput, row)
			}
			s.Country = strings.ToUpper(strings.TrimSpace(s.Country))
			if !allowed[s.Country] && l.Plan.MaxCountries > 0 {
				return fmt.Errorf("%w: %syour licence does not cover %s", ErrBadInput, row, s.Country)
			}
			if s.Qty < 1 || s.Qty > 100000 || s.AmountNGN < 0 || s.AmountNGN > 1_000_000_000 {
				return fmt.Errorf("%w: %scheck the quantity and amount", ErrBadInput, row)
			}
			if s.SoldAt.IsZero() {
				s.SoldAt = time.Now()
			}
			if s.SoldAt.After(time.Now().Add(time.Hour)) || s.SoldAt.Before(l.ValidFrom.AddDate(0, 0, -1)) {
				return fmt.Errorf("%w: %sthe date must be within your licence", ErrBadInput, row)
			}
			var ref any
			if r := clip(s.Ref, 80); r != "" {
				ref = l.Licence + ":" + r
			}
			tag, err := tx.Exec(ctx, `INSERT INTO licence_sales (licence, product_id, product, channel, country, city, qty, amount_ngn, film, sold_at, buyer, ref)
			  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (ref) DO NOTHING`,
				l.Licence, p.ID, p.Name, s.Channel, s.Country, clip(s.City, 60), s.Qty, s.AmountNGN, clip(s.Film, 80), s.SoldAt, clip(s.Buyer, 80), ref)
			if err != nil {
				return err
			}
			added += int(tag.RowsAffected())
		}
		return nil
	})
	return added, err
}

// ---- Overview (Figma 116:192) ----

type Point struct {
	Day   string `json:"day"`
	Sales int64  `json:"sales"`
}

type Share struct {
	Name  string `json:"name"`
	Value int64  `json:"value"`
	Pct   int    `json:"pct"`
}

type Top struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Sold     int    `json:"sold"`
	PriceNGN int    `json:"priceNgn"`
	Tag      string `json:"tag"`
}

type Alert struct {
	Kind   string `json:"kind"` // action, new, info
	Title  string `json:"title"`
	Detail string `json:"detail"`
	Link   string `json:"link"`
}

type Overview struct {
	SalesNGN     int64   `json:"salesNgn"`
	SalesPrevNGN int64   `json:"salesPrevNgn"`
	Items        int     `json:"items"`
	ItemsPrev    int     `json:"itemsPrev"`
	Scans        int     `json:"scans"`
	ScannedPct   int     `json:"scannedPct"`
	RoyaltyNGN   int64   `json:"royaltyNgn"`
	RoyaltyDue   string  `json:"royaltyDue"`
	Daily        []Point `json:"daily"`
	Channels     []Share `json:"channels"`
	Top          []Top   `json:"top"`
	Alerts       []Alert `json:"alerts"`
}

var channelName = map[string]string{"own": "Your shops", "shop": "E-Cinema shop", "stall": "Premiere-night stalls", "wholesale": "Wholesale"}

func shares(rows []Share) []Share {
	var total int64
	for _, r := range rows {
		total += r.Value
	}
	for i := range rows {
		if total > 0 {
			rows[i].Pct = int(math.Round(float64(rows[i].Value) * 100 / float64(total)))
		}
	}
	return rows
}

func monthStart(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC)
}

func (st Store) Overview(ctx context.Context, l Licensee, now time.Time) (Overview, error) {
	o := Overview{Daily: []Point{}, Channels: []Share{}, Top: []Top{}, Alerts: []Alert{}}
	q := `SELECT coalesce(sum(amount_ngn) FILTER (WHERE sold_at > $2::timestamptz - interval '30 days'), 0), coalesce(sum(amount_ngn) FILTER (WHERE sold_at <= $2::timestamptz::timestamptz - interval '30 days'), 0),
	    coalesce(sum(qty) FILTER (WHERE sold_at > $2::timestamptz - interval '30 days'), 0), coalesce(sum(qty) FILTER (WHERE sold_at <= $2::timestamptz::timestamptz - interval '30 days'), 0)
	  FROM licence_sales WHERE licence = $1 AND NOT returned AND sold_at > $2::timestamptz - interval '60 days' AND sold_at <= $2::timestamptz`
	if err := st.DB.QueryRow(ctx, q, l.Licence, now).Scan(&o.SalesNGN, &o.SalesPrevNGN, &o.Items, &o.ItemsPrev); err != nil {
		return o, err
	}
	if err := st.DB.QueryRow(ctx, `SELECT count(*) FROM brand_codes WHERE licence = $1 AND first_scan_at > $2::timestamptz - interval '30 days'`, l.Licence, now).Scan(&o.Scans); err != nil {
		return o, err
	}
	if o.Items > 0 {
		o.ScannedPct = int(math.Min(100, math.Round(float64(o.Scans)*100/float64(o.Items))))
	}
	var month int64
	ms := monthStart(now)
	if err := st.DB.QueryRow(ctx, `SELECT coalesce(sum(amount_ngn), 0) FROM licence_sales WHERE licence = $1 AND NOT returned AND sold_at >= $2`, l.Licence, ms).Scan(&month); err != nil {
		return o, err
	}
	o.RoyaltyNGN = month * int64(l.Plan.RoyaltyPct) / 100
	o.RoyaltyDue = ms.AddDate(0, 1, 4).Format("2006-01-02")

	rows, err := st.DB.Query(ctx, `SELECT d::date::text, coalesce((SELECT sum(amount_ngn) FROM licence_sales WHERE licence = $1 AND NOT returned AND sold_at >= d AND sold_at < d + interval '1 day'), 0)
	  FROM generate_series(date_trunc('day', $2::timestamptz) - interval '29 days', date_trunc('day', $2::timestamptz), interval '1 day') d ORDER BY d`, l.Licence, now)
	if err != nil {
		return o, err
	}
	if o.Daily, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Point, error) {
		var p Point
		return p, r.Scan(&p.Day, &p.Sales)
	}); err != nil {
		return o, err
	}
	rows, err = st.DB.Query(ctx, `SELECT channel, sum(amount_ngn) FROM licence_sales WHERE licence = $1 AND NOT returned AND sold_at > $2::timestamptz - interval '30 days' AND sold_at <= $2::timestamptz GROUP BY channel ORDER BY 2 DESC`, l.Licence, now)
	if err != nil {
		return o, err
	}
	ch, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Share, error) {
		var s Share
		var c string
		err := r.Scan(&c, &s.Value)
		s.Name = channelName[c]
		return s, err
	})
	if err != nil {
		return o, err
	}
	o.Channels = shares(ch)

	rows, err = st.DB.Query(ctx, `SELECT p.id, p.name, coalesce(sum(s.qty), 0), p.price_ngn,
	    coalesce(sum(s.qty) FILTER (WHERE s.sold_at > $2::timestamptz - interval '7 days'), 0), coalesce(sum(s.qty) FILTER (WHERE s.sold_at <= $2::timestamptz::timestamptz - interval '7 days' AND s.sold_at > $2::timestamptz - interval '14 days'), 0)
	  FROM licence_products p LEFT JOIN licence_sales s ON s.product_id = p.id AND NOT s.returned AND s.sold_at > $2::timestamptz - interval '30 days' AND s.sold_at <= $2::timestamptz
	  WHERE p.licence = $1 AND p.status = 'live' GROUP BY p.id ORDER BY 3 DESC, p.name LIMIT 3`, l.Licence, now)
	if err != nil {
		return o, err
	}
	defer rows.Close()
	for i := 0; rows.Next(); i++ {
		var t Top
		var week, prev int
		if err := rows.Scan(&t.ID, &t.Name, &t.Sold, &t.PriceNGN, &week, &prev); err != nil {
			return o, err
		}
		switch {
		case i == 0 && t.Sold > 0:
			t.Tag = "Best seller"
		case week > prev && week > 0:
			t.Tag = "Rising"
		case t.Sold > 0:
			t.Tag = "Steady"
		default:
			t.Tag = "No sales yet"
		}
		o.Top = append(o.Top, t)
	}
	if err := rows.Err(); err != nil {
		return o, err
	}
	o.Alerts, err = st.alerts(ctx, l, now)
	return o, err
}

func (st Store) alerts(ctx context.Context, l Licensee, now time.Time) ([]Alert, error) {
	out := []Alert{}
	// Copied labels: the partner's codes seen in too many places.
	var copied int
	var city string
	if err := st.DB.QueryRow(ctx, `WITH c AS (SELECT s.code, count(DISTINCT coalesce(nullif(s.city, ''), s.country)) n, mode() WITHIN GROUP (ORDER BY nullif(s.city, '')) city
	    FROM brand_scans s JOIN brand_codes b ON b.code = s.code WHERE b.licence = $1 GROUP BY s.code)
	  SELECT count(*), coalesce(mode() WITHIN GROUP (ORDER BY city), '') FROM c WHERE n > 2`, l.Licence).Scan(&copied, &city); err != nil {
		return nil, err
	}
	if copied > 0 {
		where := ""
		if city != "" {
			where = " in " + city
		}
		out = append(out, Alert{"action", "Copied labels found" + where, fmt.Sprintf("%d of your codes were scanned in too many places", copied), "/partner/codes"})
	}
	rows, err := st.DB.Query(ctx, `SELECT name, status, note FROM licence_products WHERE licence = $1 AND status <> 'review' AND coalesce(live_at, created_at) > $2::timestamptz - interval '14 days' ORDER BY coalesce(live_at, created_at) DESC LIMIT 3`, l.Licence, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var name, status, note string
		if err := rows.Scan(&name, &status, &note); err != nil {
			return nil, err
		}
		switch status {
		case "live":
			out = append(out, Alert{"new", name + " approved", "Ready to print", "/partner/products"})
		case "changes":
			out = append(out, Alert{"action", "Changes asked on " + name, note, "/partner/products"})
		case "rejected":
			out = append(out, Alert{"action", name + " was not approved", note, "/partner/products"})
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	days := int(math.Ceil(l.ValidUntil.Sub(now).Hours() / 24))
	if days <= 90 {
		out = append(out, Alert{"info", fmt.Sprintf("Licence renews in %d days", days), fmt.Sprintf("%s plan · ₦%s", l.Plan.Name, thousands(int64(feeOf(l)))), "/partner/licence"})
	}
	return out, nil
}

func feeOf(l Licensee) int { return l.Plan.FeeNGN }

func thousands(n int64) string {
	s := fmt.Sprint(n)
	for i := len(s) - 3; i > 0; i -= 3 {
		s = s[:i] + "," + s[i:]
	}
	return s
}

// ---- Sales analytics (Figma 116:441) ----

type Analytics struct {
	AvgOrderNGN   int64    `json:"avgOrderNgn"`
	AvgOrderPrev  int64    `json:"avgOrderPrev"`
	RepeatPct     int      `json:"repeatPct"`
	PremiereLift  float64  `json:"premiereLift"` // average daily sales on film nights over other days
	ReturnsPct    float64  `json:"returnsPct"`
	ByCountry     []Share  `json:"byCountry"`
	ByCity        []Share  `json:"byCity"`
	CityCountry   string   `json:"cityCountry"`
	PremiereHours []int    `json:"premiereHours"` // units by hour, 0-23, on film nights
	ByFilm        []Share  `json:"byFilm"`
	Orders        int      `json:"orders"`
	Countries     []string `json:"countries"`
	Products      []string `json:"products"`
}

// Filter narrows the analytics page (Figma 116:441 chips): a period, a country and a product.
type Filter struct {
	Days    int    // 30, 90 or 0 for this year
	Country string // "" for all
	Product string // product name, "" for all
}

func (f Filter) since(now time.Time) time.Time {
	switch f.Days {
	case 90:
		return now.AddDate(0, 0, -90)
	case 0:
		return time.Date(now.Year(), 1, 1, 0, 0, 0, 0, time.UTC)
	}
	return now.AddDate(0, 0, -30)
}

func (st Store) Analytics(ctx context.Context, l Licensee, now time.Time, f Filter) (Analytics, error) {
	a := Analytics{ByCountry: []Share{}, ByCity: []Share{}, ByFilm: []Share{}, PremiereHours: make([]int, 24), CityCountry: l.Country, Countries: []string{}, Products: []string{}}
	if f.Country != "" {
		a.CityCountry = f.Country
	}
	since := f.since(now)
	prev := since.Add(-now.Sub(since))
	// $1 licence, $2 now, $3 since, $4 country, $5 product, $6 start of the previous period.
	match := `licence = $1 AND ($4 = '' OR country = $4) AND ($5 = '' OR product = $5)`
	window := match + ` AND sold_at > $3 AND sold_at <= $2`
	args := []any{l.Licence, now, since, f.Country, f.Product, prev}
	var buyers, repeat, returned int
	var filmDays, otherDays int
	var filmSales, otherSales int64
	err := st.DB.QueryRow(ctx, `SELECT count(*) FILTER (WHERE sold_at > $3), coalesce(avg(amount_ngn) FILTER (WHERE sold_at > $3), 0)::bigint,
	    coalesce(avg(amount_ngn) FILTER (WHERE sold_at <= $3), 0)::bigint,
	    count(*) FILTER (WHERE returned AND sold_at > $3),
	    (SELECT count(*) FROM (SELECT buyer FROM licence_sales WHERE `+window+` AND buyer <> '' GROUP BY buyer) b),
	    (SELECT count(*) FROM (SELECT buyer FROM licence_sales WHERE `+window+` AND buyer <> '' GROUP BY buyer HAVING count(*) > 1) b),
	    count(DISTINCT sold_at::date) FILTER (WHERE film <> '' AND sold_at > $3), count(DISTINCT sold_at::date) FILTER (WHERE film = '' AND sold_at > $3),
	    coalesce(sum(amount_ngn) FILTER (WHERE film <> '' AND NOT returned AND sold_at > $3), 0), coalesce(sum(amount_ngn) FILTER (WHERE film = '' AND NOT returned AND sold_at > $3), 0)
	  FROM licence_sales WHERE `+match+` AND sold_at > $6 AND sold_at <= $2`, args...).Scan(&a.Orders, &a.AvgOrderNGN, &a.AvgOrderPrev, &returned, &buyers, &repeat, &filmDays, &otherDays, &filmSales, &otherSales)
	if err != nil {
		return a, err
	}
	if buyers > 0 {
		a.RepeatPct = repeat * 100 / buyers
	}
	if a.Orders > 0 {
		a.ReturnsPct = math.Round(float64(returned)*1000/float64(a.Orders)) / 10
	}
	if filmDays > 0 && otherDays > 0 && otherSales > 0 {
		a.PremiereLift = math.Round((float64(filmSales)/float64(filmDays))/(float64(otherSales)/float64(otherDays))*10) / 10
	}
	group := func(col, extra string, more ...any) ([]Share, error) {
		rows, err := st.DB.Query(ctx, `SELECT `+col+`, sum(amount_ngn) FROM licence_sales WHERE `+window+` AND NOT returned `+extra+` GROUP BY 1 ORDER BY 2 DESC LIMIT 6`, append(args[:5:5], more...)...)
		if err != nil {
			return nil, err
		}
		list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Share, error) {
			var s Share
			return s, r.Scan(&s.Name, &s.Value)
		})
		return shares(list), err
	}
	if a.ByCountry, err = group("country", ""); err != nil {
		return a, err
	}
	if a.ByCity, err = group("coalesce(nullif(city, ''), 'Not given')", "AND country = $6", a.CityCountry); err != nil {
		return a, err
	}
	if a.ByFilm, err = group("coalesce(nullif(film, ''), 'No film')", ""); err != nil {
		return a, err
	}
	// The choices for the filter chips: every country and product this partner has sold.
	if err := st.DB.QueryRow(ctx, `SELECT coalesce(array_agg(DISTINCT country), '{}'), coalesce(array_agg(DISTINCT product), '{}') FROM licence_sales WHERE licence = $1`, l.Licence).Scan(&a.Countries, &a.Products); err != nil {
		return a, err
	}
	rows, err := st.DB.Query(ctx, `SELECT extract(hour FROM sold_at AT TIME ZONE 'Africa/Lagos')::int, sum(qty) FROM licence_sales WHERE `+window+` AND film <> '' AND NOT returned GROUP BY 1`, args[:5]...)
	if err != nil {
		return a, err
	}
	defer rows.Close()
	for rows.Next() {
		var h, n int
		if err := rows.Scan(&h, &n); err != nil {
			return a, err
		}
		if h >= 0 && h < 24 {
			a.PremiereHours[h] = n
		}
	}
	return a, rows.Err()
}

// ---- Authenticity codes (Figma 116:532) ----

type Suspicious struct {
	Code   string   `json:"code"`
	Scans  int      `json:"scans"`
	Cities []string `json:"cities"`
	Ours   bool     `json:"ours"` // false: a code we never issued, seen in the partner's countries
}

type Batch struct {
	Batch     string    `json:"batch"`
	Product   string    `json:"product"`
	Count     int       `json:"count"`
	Scanned   int       `json:"scanned"`
	CreatedAt time.Time `json:"createdAt"`
}

type Codes struct {
	Issued     int          `json:"issued"`
	OnSold     int          `json:"onSold"`
	Genuine    int          `json:"genuine"`
	Suspicious int          `json:"suspicious"`
	TakenDown  int          `json:"takenDown"`
	Places     []Share      `json:"places"`
	List       []Suspicious `json:"list"`
	Batches    []Batch      `json:"batches"`
}

func (st Store) Codes(ctx context.Context, l Licensee, now time.Time) (Codes, error) {
	c := Codes{Places: []Share{}, List: []Suspicious{}, Batches: []Batch{}}
	var sold int
	if err := st.DB.QueryRow(ctx, `SELECT count(*), count(first_scan_at), (SELECT coalesce(sum(qty), 0) FROM licence_sales WHERE licence = $1 AND NOT returned) FROM brand_codes WHERE licence = $1`, l.Licence).
		Scan(&c.Issued, &c.Genuine, &sold); err != nil {
		return c, err
	}
	c.OnSold = min(c.Issued, sold)
	if err := st.DB.QueryRow(ctx, `SELECT count(*) FROM brand_reports WHERE status = 'confirmed' AND country = ANY($1) AND decided_at >= date_trunc('year', $2::timestamptz)`, l.Countries, now).Scan(&c.TakenDown); err != nil {
		return c, err
	}
	rows, err := st.DB.Query(ctx, `SELECT coalesce(nullif(s.city, ''), s.country, '?'), count(*) FROM brand_scans s JOIN brand_codes b ON b.code = s.code
	  WHERE b.licence = $1 GROUP BY 1 ORDER BY 2 DESC LIMIT 6`, l.Licence)
	if err != nil {
		return c, err
	}
	if c.Places, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Share, error) {
		var s Share
		return s, r.Scan(&s.Name, &s.Value)
	}); err != nil {
		return c, err
	}
	c.Places = shares(c.Places)
	rows, err = st.DB.Query(ctx, `WITH ours AS (
	    SELECT s.code, true AS ours, count(*) n, array_agg(DISTINCT coalesce(nullif(s.city, ''), s.country)) cities FROM brand_scans s JOIN brand_codes b ON b.code = s.code
	    WHERE b.licence = $1 GROUP BY s.code HAVING count(DISTINCT coalesce(nullif(s.city, ''), s.country)) > 2 OR count(*) > 25),
	  fake AS (
	    SELECT code, false, count(*) n, array_agg(DISTINCT coalesce(nullif(city, ''), country)) FROM brand_scans
	    WHERE NOT issued AND country = ANY($2) GROUP BY code HAVING count(*) >= 5)
	  SELECT * FROM ours UNION ALL SELECT * FROM fake ORDER BY n DESC LIMIT 20`, l.Licence, l.Countries)
	if err != nil {
		return c, err
	}
	if c.List, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Suspicious, error) {
		var s Suspicious
		return s, r.Scan(&s.Code, &s.Ours, &s.Scans, &s.Cities)
	}); err != nil {
		return c, err
	}
	for _, s := range c.List {
		c.Suspicious += s.Scans
	}
	rows, err = st.DB.Query(ctx, `SELECT batch, min(product), count(*), count(first_scan_at), min(created_at) FROM brand_codes WHERE licence = $1 AND batch <> '' GROUP BY batch ORDER BY min(created_at) DESC LIMIT 20`, l.Licence)
	if err != nil {
		return c, err
	}
	c.Batches, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Batch, error) {
		var b Batch
		return b, r.Scan(&b.Batch, &b.Product, &b.Count, &b.Scanned, &b.CreatedAt)
	})
	return c, err
}

// ---- Royalties and payouts (Figma 116:634) ----

type Statement struct {
	Month      string `json:"month"` // 2026-10
	SalesNGN   int64  `json:"salesNgn"`
	RoyaltyNGN int64  `json:"royaltyNgn"`
	ShopNGN    int64  `json:"shopNgn"`
	Status     string `json:"status"` // open, due, settled
}

type Royalties struct {
	Statements []Statement `json:"statements"`
	Current    Statement   `json:"current"`
	NetNGN     int64       `json:"netNgn"`
}

func (st Store) Royalties(ctx context.Context, l Licensee, now time.Time) (Royalties, error) {
	r := Royalties{Statements: []Statement{}}
	rows, err := st.DB.Query(ctx, `SELECT to_char(m, 'YYYY-MM'), coalesce(sum(s.amount_ngn), 0), coalesce(sum(s.amount_ngn) FILTER (WHERE s.channel = 'shop'), 0), x.settled_at IS NOT NULL
	  FROM generate_series(date_trunc('month', greatest($3::date, ($2::timestamptz - interval '11 months')::date)), date_trunc('month', $2::timestamptz), interval '1 month') m
	  LEFT JOIN licence_sales s ON s.licence = $1 AND NOT s.returned AND s.sold_at >= m AND s.sold_at < m + interval '1 month'
	  LEFT JOIN licence_settlements x ON x.licence = $1 AND x.month = m::date
	  GROUP BY m, x.settled_at ORDER BY m DESC`, l.Licence, now, l.ValidFrom)
	if err != nil {
		return r, err
	}
	defer rows.Close()
	cur := now.UTC().Format("2006-01")
	for rows.Next() {
		var s Statement
		var settled bool
		if err := rows.Scan(&s.Month, &s.SalesNGN, &s.ShopNGN, &settled); err != nil {
			return r, err
		}
		s.RoyaltyNGN = s.SalesNGN * int64(l.Plan.RoyaltyPct) / 100
		switch {
		case s.Month == cur:
			s.Status = "open"
		case settled:
			s.Status = "settled"
		default:
			s.Status = "due"
		}
		r.Statements = append(r.Statements, s)
	}
	if len(r.Statements) > 0 {
		r.Current = r.Statements[0]
	}
	r.NetNGN = r.Current.ShopNGN - r.Current.RoyaltyNGN
	return r, rows.Err()
}

// Settle marks a past month's statement as settled (the brand team does this once money has moved).
func (st Store) Settle(ctx context.Context, licence, month string) error {
	m, err := time.Parse("2006-01", month)
	if err != nil || !m.Before(monthStart(time.Now())) {
		return fmt.Errorf("%w: month", ErrBadInput)
	}
	_, err = st.DB.Exec(ctx, `INSERT INTO licence_settlements (licence, month, on_time) VALUES ($1, $2, now() < $2::date + interval '1 month 5 days') ON CONFLICT DO NOTHING`, licence, m)
	return err
}

// ---- Licence and compliance (Figma 116:726) ----

type Compliance struct {
	Score          int `json:"score"`
	SamplesOnTime  int `json:"samplesOnTime"`
	SamplesTotal   int `json:"samplesTotal"`
	MarketChecks   int `json:"marketChecks"`
	Unapproved     int `json:"unapproved"`
	RoyaltiesOK    int `json:"royaltiesOk"`
	RoyaltiesTotal int `json:"royaltiesTotal"`
	Rejected       int `json:"rejected"`
}

func (st Store) Compliance(ctx context.Context, l Licensee) (Compliance, error) {
	var c Compliance
	err := st.DB.QueryRow(ctx, `SELECT count(*) FILTER (WHERE status = 'live'), count(*) FILTER (WHERE status = 'live' AND sample_key <> ''), count(*) FILTER (WHERE status = 'rejected')
	  FROM licence_products WHERE licence = $1`, l.Licence).Scan(&c.SamplesTotal, &c.SamplesOnTime, &c.Rejected)
	if err != nil {
		return c, err
	}
	// Market checks: confirmed fake-seller reports in the partner's countries this year; none named the partner.
	if err := st.DB.QueryRow(ctx, `SELECT count(*) FROM brand_reports WHERE status IN ('confirmed', 'rejected') AND country = ANY($1) AND decided_at >= date_trunc('year', now())`, l.Countries).Scan(&c.MarketChecks); err != nil {
		return c, err
	}
	if err := st.DB.QueryRow(ctx, `SELECT count(*) FILTER (WHERE on_time), count(*) FROM licence_settlements WHERE licence = $1`, l.Licence).Scan(&c.RoyaltiesOK, &c.RoyaltiesTotal); err != nil {
		return c, err
	}
	var due int
	if err := st.DB.QueryRow(ctx, `SELECT count(*) FROM generate_series(date_trunc('month', $2::date), date_trunc('month', now()) - interval '1 month', interval '1 month') m
	  WHERE m < now() - interval '1 month 5 days' AND NOT EXISTS (SELECT 1 FROM licence_settlements x WHERE x.licence = $1 AND x.month = m::date)`, l.Licence, l.ValidFrom).Scan(&due); err != nil {
		return c, err
	}
	c.RoyaltiesTotal += due
	score := 100 - 4*(c.SamplesTotal-c.SamplesOnTime) - 5*(c.RoyaltiesTotal-c.RoyaltiesOK) - 2*c.Rejected - 10*c.Unapproved
	c.Score = max(0, min(100, score))
	return c, nil
}

// ---- Shop sales ----

// RecordShopSales counts a delivered shop order's partner items as the partner's E-Cinema shop sales.
func (st Store) RecordShopSales(ctx context.Context, orderID string) error {
	_, err := st.DB.Exec(ctx, `INSERT INTO licence_sales (licence, product_id, product, channel, country, city, qty, amount_ngn, sold_at, buyer, ref)
	  SELECT p.licence, lp.id, i.name, 'shop', o.address->>'country', coalesce(o.address->>'city', ''), i.qty, i.qty * i.unit_ngn, now(), md5(o.account_id::text), 'shop:' || o.id || ':' || i.product_id || ':' || i.variant
	  FROM shop_order_items i JOIN shop_orders o ON o.id = i.order_id JOIN shop_products p ON p.id = i.product_id
	  LEFT JOIN licence_products lp ON 'lp-' || left(replace(lp.id::text, '-', ''), 12) = p.id
	  WHERE i.order_id = $1 AND p.licence IS NOT NULL
	  ON CONFLICT (ref) DO NOTHING`, orderID)
	return err
}
