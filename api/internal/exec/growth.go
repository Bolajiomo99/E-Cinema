package exec

import (
	"context"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Growth and users (Figma 82:409): members, sign-ups, conversion and retention, for every
// country or one. Deleted-and-banned accounts are left out of every count.

type CountryGrowth struct {
	Country string `json:"country"`
	Members int    `json:"members"`
	Paid    int    `json:"paid"`
	New     int    `json:"new"`
	NewPrev int    `json:"newPrev"`
}

type Cohort struct {
	Month string `json:"month"`
	Size  int    `json:"size"`
	Weeks []int  `json:"weeks"` // members active in week 1..5 after joining; -1 when that week is still to come
}

type Growth struct {
	Days        int             `json:"days"`
	Country     string          `json:"country"`
	Members     int             `json:"members"`
	MembersPrev int             `json:"membersPrev"` // members at the start of the period
	Daily       int             `json:"daily"`
	NewWeek     int             `json:"newWeek"`
	NewWeekPrev int             `json:"newWeekPrev"`
	Paying      int             `json:"paying"`
	Months      []Month         `json:"months"` // GrossCents carries the member count at month end
	Funnel      [4]int          `json:"funnel"` // signed up, verified face + phone, watched, paid (joined in the period)
	Countries   []CountryGrowth `json:"countries"`
	Cohorts     []Cohort        `json:"cohorts"`
	Plans       map[string]int  `json:"plans"`
	CountryList []string        `json:"countryList"`
}

func (st Store) allowed(ctx context.Context, email string, roles ...string) error {
	role, err := st.Role(ctx, email)
	if err != nil {
		return err
	}
	if role == "ceo" || (role != "" && slices.Contains(roles, role)) {
		return nil
	}
	return ErrForbidden
}

func (st Store) Growth(ctx context.Context, email string, days int, country string, now time.Time) (Growth, error) {
	g := Growth{Days: days, Months: []Month{}, Countries: []CountryGrowth{}, Cohorts: []Cohort{}, Plans: map[string]int{}, CountryList: []string{}}
	if err := st.allowed(ctx, email, "cfo", "coo", "cmo"); err != nil {
		return g, err
	}
	if days != 7 && days != 30 && days != 90 {
		days, g.Days = 30, 30
	}
	country = strings.ToUpper(strings.TrimSpace(country))
	if len(country) != 2 {
		country = ""
	}
	g.Country = country
	from := now.AddDate(0, 0, -days)
	// $1 country filter ("" = all), used by every query through this view.
	members := `(SELECT * FROM accounts WHERE banned_at IS NULL AND delete_after IS NULL AND ($1 = '' OR upper(trim(coalesce(country, ''))) = $1))`
	if err := st.DB.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE created_at < $2), count(*) FILTER (WHERE created_at >= $3::timestamptz - interval '7 days'),
	    count(*) FILTER (WHERE created_at >= $3::timestamptz - interval '14 days' AND created_at < $3::timestamptz - interval '7 days'),
	    count(*) FILTER (WHERE plan <> 'free' AND plan_status = 'active')
	  FROM `+members+` m`, country, from, now).Scan(&g.Members, &g.MembersPrev, &g.NewWeek, &g.NewWeekPrev, &g.Paying); err != nil {
		return g, err
	}
	if err := st.DB.QueryRow(ctx, `SELECT count(DISTINCT s.account_id) FROM account_sessions s JOIN `+members+` m ON m.id = s.account_id WHERE s.last_seen_at >= $2::timestamptz - interval '1 day'`, country, now).Scan(&g.Daily); err != nil {
		return g, err
	}
	// Members at the end of each of the last twelve months.
	lagos := time.FixedZone("WAT", 3600)
	l := now.In(lagos)
	for i := 11; i >= 0; i-- {
		end := time.Date(l.Year(), l.Month()-time.Month(i)+1, 1, 0, 0, 0, 0, lagos)
		if end.After(now) {
			end = now
		}
		var n int64
		if err := st.DB.QueryRow(ctx, `SELECT count(*) FROM `+members+` m WHERE created_at < $2`, country, end).Scan(&n); err != nil {
			return g, err
		}
		g.Months = append(g.Months, Month{Month: time.Date(l.Year(), l.Month()-time.Month(i), 1, 0, 0, 0, 0, lagos).Format("2006-01"), GrossCents: n})
	}
	// Funnel for people who joined in the period.
	if err := st.DB.QueryRow(ctx, `SELECT count(*),
	    count(*) FILTER (WHERE face_verified_at IS NOT NULL AND phone_verified_at IS NOT NULL),
	    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM watch_beats w WHERE w.account_id = m.id)),
	    count(*) FILTER (WHERE (plan <> 'free' AND plan_status = 'active') OR EXISTS (SELECT 1 FROM holds h WHERE h.account_id = m.id AND h.status = 'paid' AND h.paypal_order_id IS NOT NULL))
	  FROM `+members+` m WHERE created_at >= $2`, country, from).Scan(&g.Funnel[0], &g.Funnel[1], &g.Funnel[2], &g.Funnel[3]); err != nil {
		return g, err
	}
	rows, err := st.DB.Query(ctx, `SELECT upper(trim(country)), count(*)::int, count(*) FILTER (WHERE plan <> 'free' AND plan_status = 'active')::int,
	    count(*) FILTER (WHERE created_at >= $2)::int, count(*) FILTER (WHERE created_at >= $2::timestamptz - ($3::timestamptz - $2::timestamptz) AND created_at < $2)::int
	  FROM `+members+` m WHERE coalesce(trim(country), '') <> '' GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 12`, country, from, now)
	if err != nil {
		return g, err
	}
	if g.Countries, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (CountryGrowth, error) {
		var c CountryGrowth
		return c, r.Scan(&c.Country, &c.Members, &c.Paid, &c.New, &c.NewPrev)
	}); err != nil {
		return g, err
	}
	// Retention: of each of the last four monthly cohorts, who was active (watched or booked) in
	// each of their first five weeks.
	rows, err = st.DB.Query(ctx, `WITH c AS (SELECT id, created_at, to_char(date_trunc('month', created_at AT TIME ZONE 'Africa/Lagos'), 'YYYY-MM') AS month FROM `+members+` m
	    WHERE created_at >= date_trunc('month', ($2::timestamptz AT TIME ZONE 'Africa/Lagos') - interval '3 months') AT TIME ZONE 'Africa/Lagos'),
	  act AS (SELECT account_id, day::timestamptz + interval '12 hours' AS at FROM watch_beats UNION ALL SELECT account_id, created_at FROM holds WHERE account_id IS NOT NULL),
	  wk AS (SELECT DISTINCT c.id, floor(extract(epoch FROM a.at - c.created_at) / 604800)::int + 1 AS w FROM c JOIN act a ON a.account_id = c.id WHERE a.at >= c.created_at)
	  SELECT c.month, count(DISTINCT c.id)::int,
	    array[1,2,3,4,5]::int[] AS weeks,
	    array(SELECT CASE WHEN min(c2.created_at) + make_interval(days => 7 * (n - 1)) > $2 THEN -1 ELSE count(DISTINCT wk.id) FILTER (WHERE wk.w = n)::int END
	      FROM generate_series(1, 5) n LEFT JOIN c c2 ON c2.month = c.month LEFT JOIN wk ON wk.id = c2.id GROUP BY n ORDER BY n)
	  FROM c GROUP BY c.month ORDER BY c.month`, country, now)
	if err != nil {
		return g, err
	}
	if g.Cohorts, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Cohort, error) {
		var c Cohort
		var idx []int
		return c, r.Scan(&c.Month, &c.Size, &idx, &c.Weeks)
	}); err != nil {
		return g, err
	}
	rows, err = st.DB.Query(ctx, `SELECT CASE WHEN plan_status = 'active' THEN plan ELSE 'free' END, count(*)::int FROM `+members+` m GROUP BY 1`, country)
	if err != nil {
		return g, err
	}
	for rows.Next() {
		var p string
		var n int
		if err := rows.Scan(&p, &n); err != nil {
			rows.Close()
			return g, err
		}
		g.Plans[p] += n
	}
	rows.Close()
	rows, err = st.DB.Query(ctx, `SELECT DISTINCT upper(trim(country)) FROM accounts WHERE coalesce(trim(country), '') <> '' AND banned_at IS NULL ORDER BY 1`)
	if err != nil {
		return g, err
	}
	g.CountryList, err = pgx.CollectRows(rows, pgx.RowTo[string])
	return g, err
}

// Allow checks the caller is the CEO or holds one of the roles.
func (st Store) Allow(ctx context.Context, email string, roles ...string) error {
	return st.allowed(ctx, email, roles...)
}
