package studios

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// ---- Analytics (Figma 37:1652 Audience, 37:2861 Reach) ----
// Every number comes from the studio's own screenings: watch time, reviews, rewatch parties,
// tickets and refunds. Studios see groups and counts, never who watched.

type Analytics struct {
	Days           int       `json:"days"`
	From           time.Time `json:"from"`
	To             time.Time `json:"to"`
	ShareBps       int       `json:"shareBps"`
	Viewers        int       `json:"viewers"`
	ViewersPrev    int       `json:"viewersPrev"`
	WatchHours     float64   `json:"watchHours"`
	WatchHoursPrev float64   `json:"watchHoursPrev"`
	Completion     float64   `json:"completion"`
	CompletionPrev float64   `json:"completionPrev"`
	Rewatch        int       `json:"rewatch"`
	RewatchPrev    int       `json:"rewatchPrev"`
	NPS            *int      `json:"nps"`
	NPSPrev        *int      `json:"npsPrev"`
	Reviews        int       `json:"reviews"`
	Ages           []Count   `json:"ages"`
	Genders        []Count   `json:"genders"`
	WithFriends    float64   `json:"withFriends"`
	Plans          []Count   `json:"plans"`
	Countries      []Country `json:"countries"`
	Audio          []Count   `json:"audio"`
	Cohorts        []Cohort  `json:"cohorts"`
	Money          Money     `json:"money"`
	Funnel         Funnel    `json:"funnel"`
	Audience       any       `json:"audience"` // retention, hours and devices from player reports (filled by the API)
}

// Country is one row of "Top countries": people who watched, and what their tickets brought in.
type Country struct {
	Country    string `json:"country"`
	Viewers    int    `json:"viewers"`
	GrossCents int64  `json:"grossCents"`
}

// Cohort is people who first watched this studio's films in Month, and the share who came back after.
type Cohort struct {
	Month string    `json:"month"`
	Size  int       `json:"size"`
	Back  []float64 `json:"back"` // Back[0] is one month later
}

type Money struct {
	GrossCents     int64 `json:"grossCents"`
	PlatformCents  int64 `json:"platformCents"`
	RefundCents    int64 `json:"refundCents"`
	ShareCents     int64 `json:"shareCents"`
	PerViewerCents int64 `json:"perViewerCents"`
	Buyers         int   `json:"buyers"`
}

type Funnel struct {
	Orders int `json:"orders"`
	Seats  int `json:"seats"`
	Gifts  int `json:"gifts"`
}

var AnalyticsDays = map[int]bool{7: true, 30: true, 90: true, 365: true}

// viewed is each (viewer, screening) pair of the studio's films with watch time in [$2, $3).
const viewed = `SELECT b.account_id, b.showtime_id, sum(b.seconds) secs, max(s.duration_min) dur
  FROM watch_beats b JOIN showtimes s ON s.id = b.showtime_id
  WHERE s.studio = $1 AND b.day >= $2::date AND b.day < $3::date GROUP BY 1, 2`

func (st Store) Analytics(ctx context.Context, acct, email string, days int, now time.Time) (Analytics, error) {
	s, err := st.verified(ctx, acct, email, false)
	if err != nil {
		return Analytics{}, err
	}
	if !AnalyticsDays[days] {
		days = 90
	}
	to := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC).AddDate(0, 0, 1)
	from := to.AddDate(0, 0, -days)
	prev := from.AddDate(0, 0, -days)
	a := Analytics{Days: days, From: from, To: to, ShareBps: s.ShareBps, Ages: []Count{}, Genders: []Count{}, Plans: []Count{},
		Countries: []Country{}, Audio: []Count{}, Cohorts: []Cohort{}}

	period := func(lo, hi time.Time) (viewers int, hours, completion float64, rewatch int, nps *int, reviews int, err error) {
		err = st.DB.QueryRow(ctx, `SELECT count(DISTINCT account_id), coalesce(sum(secs), 0) / 3600.0,
		    coalesce(avg(least(1.0, secs / (dur * 60.0))), 0) FROM (`+viewed+`) v`, s.Name, lo, hi).Scan(&viewers, &hours, &completion)
		if err != nil {
			return
		}
		if err = st.DB.QueryRow(ctx, `SELECT count(*) FROM rewatch_parties r JOIN showtimes s ON s.id = r.showtime_id
		    WHERE s.studio = $1 AND r.created_at >= $2 AND r.created_at < $3`, s.Name, lo, hi).Scan(&rewatch); err != nil {
			return
		}
		// Net promoter from star reviews: five stars promote, three or fewer detract.
		var five, low int
		if err = st.DB.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE r.stars = 5), count(*) FILTER (WHERE r.stars <= 3)
		    FROM reviews r JOIN showtimes s ON s.id = r.showtime_id
		    WHERE s.studio = $1 AND NOT r.hidden AND r.created_at >= $2 AND r.created_at < $3`, s.Name, lo, hi).Scan(&reviews, &five, &low); err != nil {
			return
		}
		if reviews > 0 {
			n := (five - low) * 100 / reviews
			nps = &n
		}
		return
	}
	if a.Viewers, a.WatchHours, a.Completion, a.Rewatch, a.NPS, a.Reviews, err = period(from, to); err != nil {
		return a, fmt.Errorf("analytics period: %w", err)
	}
	if a.ViewersPrev, a.WatchHoursPrev, a.CompletionPrev, a.RewatchPrev, a.NPSPrev, _, err = period(prev, from); err != nil {
		return a, fmt.Errorf("analytics previous: %w", err)
	}

	counts := func(q string, args ...any) ([]Count, error) {
		rows, err := st.DB.Query(ctx, q, args...)
		if err != nil {
			return nil, err
		}
		return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Count, error) {
			var c Count
			err := r.Scan(&c.Key, &c.Seats)
			return c, err
		})
	}
	people := `SELECT DISTINCT v.account_id FROM (` + viewed + `) v`
	if a.Ages, err = counts(`SELECT CASE WHEN x.birth_date IS NULL THEN 'unknown'
	      WHEN age($4::date, x.birth_date) < interval '18 years' THEN 'under 18'
	      WHEN age($4::date, x.birth_date) < interval '25 years' THEN '18-24'
	      WHEN age($4::date, x.birth_date) < interval '35 years' THEN '25-34'
	      WHEN age($4::date, x.birth_date) < interval '45 years' THEN '35-44'
	      WHEN age($4::date, x.birth_date) < interval '55 years' THEN '45-54' ELSE '55+' END, count(*)
	    FROM (`+people+`) p JOIN accounts x ON x.id = p.account_id GROUP BY 1 ORDER BY 1`, s.Name, from, to, now); err != nil {
		return a, fmt.Errorf("analytics ages: %w", err)
	}
	if a.Genders, err = counts(`SELECT coalesce(nullif(x.gender, ''), 'unknown'), count(*)
	    FROM (`+people+`) p JOIN accounts x ON x.id = p.account_id GROUP BY 1 ORDER BY 2 DESC`, s.Name, from, to); err != nil {
		return a, err
	}
	if a.Plans, err = counts(`SELECT x.plan, count(*) FROM (`+people+`) p JOIN accounts x ON x.id = p.account_id GROUP BY 1 ORDER BY 2 DESC`, s.Name, from, to); err != nil {
		return a, err
	}
	if a.Audio, err = counts(`SELECT b.audio, count(DISTINCT b.account_id) FROM watch_beats b JOIN showtimes s ON s.id = b.showtime_id
	    WHERE s.studio = $1 AND b.day >= $2::date AND b.day < $3::date GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, s.Name, from, to); err != nil {
		return a, err
	}
	if err = st.DB.QueryRow(ctx, `SELECT coalesce(avg(CASE WHEN EXISTS (SELECT 1 FROM party_members m JOIN parties p ON p.id = m.party_id
	    WHERE m.account_id = v.account_id AND p.showtime_id = v.showtime_id) THEN 1.0 ELSE 0 END), 0) FROM (`+viewed+`) v`, s.Name, from, to).Scan(&a.WithFriends); err != nil {
		return a, err
	}

	// Countries: viewers from watch time, money from tickets bought in the period.
	rows, err := st.DB.Query(ctx, `WITH w AS (SELECT x.country, count(*) n FROM (`+people+`) p JOIN accounts x ON x.id = p.account_id WHERE x.country IS NOT NULL GROUP BY 1),
	    m AS (SELECT x.country, sum(`+netExpr+`) g FROM holds h JOIN showtimes s ON s.id = h.showtime_id JOIN accounts x ON x.id = h.account_id
	      WHERE s.studio = $1 AND h.status = 'paid' AND h.created_at >= $2 AND h.created_at < $3 AND x.country IS NOT NULL GROUP BY 1)
	  SELECT coalesce(w.country, m.country), coalesce(w.n, 0), coalesce(m.g, 0) FROM w FULL JOIN m ON m.country = w.country
	  ORDER BY 2 DESC, 3 DESC LIMIT 12`, s.Name, from, to)
	if err != nil {
		return a, err
	}
	if a.Countries, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Country, error) {
		var c Country
		err := r.Scan(&c.Country, &c.Viewers, &c.GrossCents)
		return c, err
	}); err != nil {
		return a, fmt.Errorf("analytics countries: %w", err)
	}

	// Money in the period: refunds are tickets refunded, whenever they were bought.
	m := &a.Money
	if err = st.DB.QueryRow(ctx, `SELECT coalesce(sum(`+netExpr+`) FILTER (WHERE h.status IN ('paid', 'refunded') AND h.created_at >= $2 AND h.created_at < $3), 0),
	    coalesce(sum(`+netExpr+`) FILTER (WHERE h.status = 'refunded' AND h.refunded_at >= $2 AND h.refunded_at < $3), 0),
	    count(DISTINCT h.account_id) FILTER (WHERE h.status = 'paid' AND h.created_at >= $2 AND h.created_at < $3),
	    count(*) FILTER (WHERE h.status = 'paid' AND h.created_at >= $2 AND h.created_at < $3),
	    coalesce(sum(h.seats) FILTER (WHERE h.status = 'paid' AND h.created_at >= $2 AND h.created_at < $3), 0)
	  FROM holds h JOIN showtimes s ON s.id = h.showtime_id WHERE s.studio = $1`, s.Name, from, to).Scan(&m.GrossCents, &m.RefundCents, &m.Buyers, &a.Funnel.Orders, &a.Funnel.Seats); err != nil {
		return a, fmt.Errorf("analytics money: %w", err)
	}
	net := max(m.GrossCents-m.RefundCents, 0)
	m.ShareCents = net * int64(s.ShareBps) / 10000
	m.PlatformCents = net - m.ShareCents
	if m.Buyers > 0 {
		m.PerViewerCents = net / int64(m.Buyers)
	}
	if err = st.DB.QueryRow(ctx, `SELECT count(*) FROM gifts g JOIN showtimes s ON s.id = g.showtime_id
	    WHERE s.studio = $1 AND g.status <> 'pending' AND g.created_at >= $2 AND g.created_at < $3`, s.Name, from, to).Scan(&a.Funnel.Gifts); err != nil {
		return a, fmt.Errorf("analytics gifts: %w", err)
	}

	// Cohorts: the last six months, by the month each viewer first watched one of the studio's films.
	first := monthStart(to.AddDate(0, 0, -1)).AddDate(0, -5, 0)
	rows, err = st.DB.Query(ctx, `WITH f AS (SELECT b.account_id, date_trunc('month', min(b.day))::date m FROM watch_beats b JOIN showtimes s ON s.id = b.showtime_id
	      WHERE s.studio = $1 GROUP BY 1),
	    act AS (SELECT DISTINCT b.account_id, date_trunc('month', b.day)::date m FROM watch_beats b JOIN showtimes s ON s.id = b.showtime_id WHERE s.studio = $1)
	  SELECT to_char(f.m, 'YYYY-MM'), count(*),
	    array(SELECT coalesce(count(DISTINCT act.account_id)::float8 / nullif(count(DISTINCT f2.account_id), 0), 0)
	      FROM generate_series(1, 5) k CROSS JOIN f f2 LEFT JOIN act ON act.account_id = f2.account_id AND act.m = (f.m + make_interval(months => k))::date
	      WHERE f2.m = f.m AND (f.m + make_interval(months => k))::date <= $3::date GROUP BY k ORDER BY k)
	  FROM f WHERE f.m >= $2::date GROUP BY f.m ORDER BY f.m`, s.Name, first, monthStart(to.AddDate(0, 0, -1)))
	if err != nil {
		return a, err
	}
	if a.Cohorts, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Cohort, error) {
		var c Cohort
		err := r.Scan(&c.Month, &c.Size, &c.Back)
		return c, err
	}); err != nil {
		return a, fmt.Errorf("analytics cohorts: %w", err)
	}
	return a, nil
}
