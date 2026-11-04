// Package exec serves the executive dashboards (Figma page "07 Executive"): who may see them and
// the company-wide numbers they show. Every number is read from the live tables.
package exec

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrForbidden = errors.New("executives only")

type Store struct {
	DB   *pgxpool.Pool
	CEOs []string // lower-case emails with full access
}

// Role is the caller's executive role, or "" when they have none.
func (st Store) Role(ctx context.Context, email string) (string, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	for _, c := range st.CEOs {
		if c != "" && c == email {
			return "ceo", nil
		}
	}
	var role string
	err := st.DB.QueryRow(ctx, `SELECT role FROM executives WHERE email = $1 AND NOT pending AND (expires_on IS NULL OR expires_on >= (now() AT TIME ZONE 'Africa/Lagos')::date)`, email).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return role, err
}

// Who sees the command center: the CEO and the operating officers.
func commandRole(role string) bool {
	return role == "ceo" || role == "cfo" || role == "coo" || role == "cto" || role == "cmo"
}

type Month struct {
	Month      string `json:"month"` // 2026-10
	GrossCents int64  `json:"grossCents"`
	NetCents   int64  `json:"netCents"`
}

type Share struct {
	Country string `json:"country"`
	Seats   int    `json:"seats"`
}

type Decision struct {
	Kind  string `json:"kind"` // studios, bans, licences, refunds, payouts
	Count int    `json:"count"`
}

type Command struct {
	Role           string     `json:"role"`
	Name           string     `json:"name"`
	RevenueToday   int64      `json:"revenueToday"`
	RevenueWeekAgo int64      `json:"revenueWeekAgo"`
	Revenue30      int64      `json:"revenue30"`
	RevenuePrev30  int64      `json:"revenuePrev30"`
	Paying         int        `json:"paying"`
	PayingWeek     int        `json:"payingWeek"`
	Members        int        `json:"members"`
	Countries      int        `json:"countries"`
	CountriesNew   int        `json:"countriesNew"`
	LiveNow        int        `json:"liveNow"`
	OrdersToday    int        `json:"ordersToday"`
	ShopTodayNGN   int64      `json:"shopTodayNgn"`
	Studios        int        `json:"studios"`
	StudiosWeek    int        `json:"studiosWeek"`
	NPS            int        `json:"nps"`
	NPSPrev        int        `json:"npsPrev"`
	Reviews        int        `json:"reviews"`
	Months         []Month    `json:"months"`
	Watching       []Share    `json:"watching"`
	Decisions      []Decision `json:"decisions"`
}

// Command is the CEO command center (Figma 49:1055). now is passed in for tests; days start at
// midnight in Lagos.
func (st Store) Command(ctx context.Context, email string, now time.Time) (Command, error) {
	role, err := st.Role(ctx, email)
	if err != nil {
		return Command{}, err
	}
	if !commandRole(role) {
		return Command{}, ErrForbidden
	}
	c := Command{Role: role, Months: []Month{}, Watching: []Share{}, Decisions: []Decision{}}
	lagos := time.FixedZone("WAT", 3600)
	l := now.In(lagos)
	today := time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, lagos)
	_ = st.DB.QueryRow(ctx, `SELECT coalesce(name, '') FROM accounts WHERE lower(email) = lower($1)`, email).Scan(&c.Name)
	// Ticket revenue counts paid seats in US dollars (the catalog's base currency); refunds are out.
	paid := `FROM holds h JOIN showtimes s ON s.id = h.showtime_id WHERE h.status = 'paid' AND s.currency = 'USD'`
	q := `SELECT
	  coalesce(sum(coalesce(h.net_cents, h.seats * s.price_cents)) FILTER (WHERE h.created_at >= $1), 0),
	  coalesce(sum(coalesce(h.net_cents, h.seats * s.price_cents)) FILTER (WHERE h.created_at >= $1::timestamptz - interval '7 days' AND h.created_at < $2::timestamptz - interval '7 days'), 0),
	  coalesce(sum(coalesce(h.net_cents, h.seats * s.price_cents)) FILTER (WHERE h.created_at >= $2::timestamptz - interval '30 days'), 0),
	  coalesce(sum(coalesce(h.net_cents, h.seats * s.price_cents)) FILTER (WHERE h.created_at >= $2::timestamptz - interval '60 days' AND h.created_at < $2::timestamptz - interval '30 days'), 0) ` + paid
	if err := st.DB.QueryRow(ctx, q, today, now).Scan(&c.RevenueToday, &c.RevenueWeekAgo, &c.Revenue30, &c.RevenuePrev30); err != nil {
		return c, err
	}
	if err := st.DB.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE plan <> 'free' AND plan_status = 'active'),
	    count(*) FILTER (WHERE plan <> 'free' AND plan_status = 'active' AND created_at >= $1::timestamptz - interval '7 days')
	  FROM accounts WHERE banned_at IS NULL`, now).Scan(&c.Members, &c.Paying, &c.PayingWeek); err != nil {
		return c, err
	}
	// Countries with paying viewers in the last 30 days, and how many are new against the 30 before.
	if err := st.DB.QueryRow(ctx, `WITH b AS (SELECT a.country, min(h.created_at) AS first FROM holds h JOIN accounts a ON a.id = h.account_id
	    WHERE h.status = 'paid' AND coalesce(a.country, '') <> '' GROUP BY a.country)
	  SELECT count(*) FILTER (WHERE first IS NOT NULL), count(*) FILTER (WHERE first >= $1::timestamptz - interval '30 days') FROM b`, now).Scan(&c.Countries, &c.CountriesNew); err != nil {
		return c, err
	}
	if err := st.DB.QueryRow(ctx, `SELECT count(*) FROM showtimes WHERE starts_at <= $1 AND starts_at + make_interval(mins => duration_min) > $1`, now).Scan(&c.LiveNow); err != nil {
		return c, err
	}
	if err := st.DB.QueryRow(ctx, `SELECT count(*), coalesce(sum(total_ngn), 0) FROM shop_orders WHERE placed_at >= $1 AND cancelled_at IS NULL`, today).Scan(&c.OrdersToday, &c.ShopTodayNGN); err != nil {
		return c, err
	}
	if err := st.DB.QueryRow(ctx, `SELECT count(*) FILTER (WHERE status = 'verified'), count(*) FILTER (WHERE status = 'verified' AND verified_at >= $1::timestamptz - interval '7 days') FROM studios`, now).Scan(&c.Studios, &c.StudiosWeek); err != nil {
		return c, err
	}
	// Net promoter from star ratings: 5 promotes, 3 or fewer detracts.
	nps := func(from, to string) (int, int, error) {
		var n, pro, det int
		err := st.DB.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE stars = 5), count(*) FILTER (WHERE stars <= 3) FROM reviews
		  WHERE NOT hidden AND created_at >= $1::timestamptz - `+from+` AND created_at < $1::timestamptz - `+to, now).Scan(&n, &pro, &det)
		if n == 0 {
			return 0, 0, err
		}
		return (pro - det) * 100 / n, n, err
	}
	if c.NPS, c.Reviews, err = nps("interval '90 days'", "interval '0 days'"); err != nil {
		return c, err
	}
	if c.NPSPrev, _, err = nps("interval '180 days'", "interval '90 days'"); err != nil {
		return c, err
	}
	// Twelve months of ticket revenue: gross, and E-Cinema's 30% after the studios' 70%.
	rows, err := st.DB.Query(ctx, `SELECT to_char(date_trunc('month', h.created_at AT TIME ZONE 'Africa/Lagos'), 'YYYY-MM'), sum(coalesce(h.net_cents, h.seats * s.price_cents)) `+paid+`
	  AND h.created_at >= $1::timestamptz - interval '12 months' GROUP BY 1`, now)
	if err != nil {
		return c, err
	}
	by := map[string]int64{}
	for rows.Next() {
		var m string
		var v int64
		if err := rows.Scan(&m, &v); err != nil {
			rows.Close()
			return c, err
		}
		by[m] = v
	}
	rows.Close()
	for i := 11; i >= 0; i-- {
		m := time.Date(l.Year(), l.Month()-time.Month(i), 1, 0, 0, 0, 0, lagos).Format("2006-01")
		c.Months = append(c.Months, Month{Month: m, GrossCents: by[m], NetCents: by[m] * 30 / 100})
	}
	// Where paid seats went in the last 30 days, by the buyer's country.
	rows, err = st.DB.Query(ctx, `SELECT a.country, sum(h.seats)::int FROM holds h JOIN accounts a ON a.id = h.account_id
	  WHERE h.status = 'paid' AND h.created_at >= $1::timestamptz - interval '30 days' AND coalesce(a.country, '') <> '' GROUP BY 1 ORDER BY 2 DESC LIMIT 40`, now)
	if err != nil {
		return c, err
	}
	c.Watching, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Share, error) {
		var s Share
		err := r.Scan(&s.Country, &s.Seats)
		s.Country = strings.TrimSpace(s.Country)
		return s, err
	})
	if err != nil {
		return c, err
	}
	// Queues waiting on a decision, each answered on its own desk.
	for _, d := range []struct{ kind, q string }{
		{"studios", `SELECT count(*) FROM studios WHERE status = 'submitted'`},
		{"bans", `SELECT count(*) FROM studio_leaks WHERE ban = 'requested'`},
		{"licences", `SELECT count(*) FROM licence_applications WHERE status = 'submitted'`},
		{"refunds", `SELECT count(*) FROM shop_refunds WHERE status = 'review'`},
		{"payouts", `SELECT count(*) FROM studio_payouts WHERE status = 'failed'`},
	} {
		var n int
		if err := st.DB.QueryRow(ctx, d.q).Scan(&n); err != nil {
			return c, err
		}
		if n > 0 {
			c.Decisions = append(c.Decisions, Decision{Kind: d.kind, Count: n})
		}
	}
	sort.SliceStable(c.Decisions, func(i, j int) bool { return c.Decisions[i].Count > c.Decisions[j].Count })
	return c, nil
}
