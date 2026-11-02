package exec

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Brand protection (Figma 117:1216): fake merch reported by the community, settled on the rewards desk.

type BrandCase struct {
	ID      string    `json:"id"`
	Selling string    `json:"selling"`
	Place   string    `json:"place"`
	Country string    `json:"country"`
	AINote  string    `json:"aiNote"`
	Status  string    `json:"status"`
	At      time.Time `json:"at"`
}

type BrandWeek struct {
	Week      time.Time `json:"week"`
	Reports   int       `json:"reports"`
	Confirmed int       `json:"confirmed"`
}

type BrandReporter struct {
	Name      string `json:"name"`
	Confirmed int    `json:"confirmed"`
}

type Brand struct {
	Month       int             `json:"month"`
	PrevMonth   int             `json:"prevMonth"`
	Confirmed   int             `json:"confirmed"` // this month
	Decided     int             `json:"decided"`   // this month
	TakenDown   int             `json:"takenDown"` // all time
	AvgDays     float64         `json:"avgDays"`
	RewardsNGN  int64           `json:"rewardsNgn"`
	Rewarded    int             `json:"rewarded"` // members paid
	Queue       []BrandCase     `json:"queue"`
	Countries   map[string]int  `json:"countries"`
	Online      int             `json:"online"` // reports from online listings and social media
	Total       int             `json:"total"`
	Weeks       []BrandWeek     `json:"weeks"`
	TopReporter []BrandReporter `json:"topReporters"`
}

func shortName(full string) string {
	w := strings.Fields(full)
	if len(w) == 0 {
		return "Member"
	}
	if len(w) == 1 {
		return w[0]
	}
	last := []rune(w[len(w)-1])
	return w[0] + " " + strings.ToUpper(string(last[0])) + "."
}

func (st Store) Brand(ctx context.Context, email string, now time.Time) (Brand, error) {
	b := Brand{Queue: []BrandCase{}, Countries: map[string]int{}, Weeks: []BrandWeek{}, TopReporter: []BrandReporter{}}
	if err := st.allowed(ctx, email, "cmo"); err != nil {
		return b, err
	}
	month := monthStart(now)
	prev := month.AddDate(0, -1, 0)
	if err := st.DB.QueryRow(ctx, `SELECT
	    count(*) FILTER (WHERE created_at >= $1)::int, count(*) FILTER (WHERE created_at >= $2 AND created_at < $1)::int,
	    count(*) FILTER (WHERE created_at >= $1 AND status = 'confirmed')::int,
	    count(*) FILTER (WHERE created_at >= $1 AND status IN ('confirmed', 'rejected', 'false'))::int,
	    count(*) FILTER (WHERE status = 'confirmed' AND outcome ILIKE '%taken down%')::int,
	    coalesce(avg(extract(epoch FROM decided_at - created_at) / 86400) FILTER (WHERE status = 'confirmed'), 0)::float8,
	    coalesce(sum(reward_ngn) FILTER (WHERE status = 'confirmed'), 0)::bigint,
	    count(DISTINCT account_id) FILTER (WHERE status = 'confirmed')::int,
	    count(*) FILTER (WHERE place IN ('online', 'social'))::int, count(*)::int
	  FROM brand_reports WHERE status <> 'false'`, month, prev).Scan(&b.Month, &b.PrevMonth, &b.Confirmed, &b.Decided, &b.TakenDown, &b.AvgDays,
		&b.RewardsNGN, &b.Rewarded, &b.Online, &b.Total); err != nil {
		return b, err
	}
	rows, err := st.DB.Query(ctx, `SELECT id::text, selling, place, country, ai_note, status, created_at FROM brand_reports
	  WHERE status IN ('sent', 'checking') ORDER BY created_at LIMIT 8`)
	if err != nil {
		return b, err
	}
	if b.Queue, err = pgx.CollectRows(rows, pgx.RowToStructByPos[BrandCase]); err != nil {
		return b, err
	}
	rows, err = st.DB.Query(ctx, `SELECT country, count(*)::int FROM brand_reports WHERE status <> 'false' AND country <> '' GROUP BY country ORDER BY count(*) DESC LIMIT 8`)
	if err != nil {
		return b, err
	}
	for rows.Next() {
		var c string
		var n int
		if err := rows.Scan(&c, &n); err != nil {
			rows.Close()
			return b, err
		}
		b.Countries[c] = n
	}
	rows.Close()
	lagos := time.FixedZone("WAT", 3600)
	l := now.In(lagos)
	monday := time.Date(l.Year(), l.Month(), l.Day()-((int(l.Weekday())+6)%7), 0, 0, 0, 0, lagos)
	rows, err = st.DB.Query(ctx, `SELECT w, (SELECT count(*)::int FROM brand_reports WHERE created_at >= w AND created_at < w + interval '7 days'),
	    (SELECT count(*)::int FROM brand_reports WHERE status = 'confirmed' AND decided_at >= w AND decided_at < w + interval '7 days')
	  FROM generate_series($1::timestamptz - interval '11 weeks', $1::timestamptz, interval '7 days') w ORDER BY w`, monday)
	if err != nil {
		return b, err
	}
	if b.Weeks, err = pgx.CollectRows(rows, pgx.RowToStructByPos[BrandWeek]); err != nil {
		return b, err
	}
	rows, err = st.DB.Query(ctx, `SELECT a.name, count(*)::int FROM brand_reports r JOIN accounts a ON a.id = r.account_id
	  WHERE r.status = 'confirmed' AND NOT r.anonymous GROUP BY a.id, a.name ORDER BY count(*) DESC, min(r.decided_at) LIMIT 3`)
	if err != nil {
		return b, err
	}
	if b.TopReporter, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (BrandReporter, error) {
		var x BrandReporter
		err := r.Scan(&x.Name, &x.Confirmed)
		x.Name = shortName(x.Name)
		return x, err
	}); err != nil {
		return b, err
	}
	return b, nil
}

// CanLicensing lets the CMO and CFO read the licensing book (Figma 117:1481).
func (st Store) CanLicensing(ctx context.Context, email string) error {
	return st.allowed(ctx, email, "cmo", "cfo")
}
