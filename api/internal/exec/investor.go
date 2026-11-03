package exec

import (
	"context"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// Investor view (Figma 50:609): aggregated figures only, no personal data. Revenue is E-Cinema's
// net (after the studios' 70% of tickets), from the same paid bookings as the Money page.

type MonthNet struct {
	Month    string `json:"month"` // 2026-11
	Currency string `json:"currency"`
	Net      int64  `json:"net"` // minor units
}

type CurAmount struct {
	Currency string `json:"currency"`
	Minor    int64  `json:"minor"`
}

type Milestone struct {
	ID      int64  `json:"id"`
	Quarter string `json:"quarter"`
	Title   string `json:"title"`
	Done    bool   `json:"done"`
}

type Investor struct {
	Months     []MonthNet     `json:"months"`    // the last 12 Lagos months
	Net30      []CurAmount    `json:"net30"`     // last 30 days
	NetPrev30  []CurAmount    `json:"netPrev30"` // the same 30 days a year ago
	Gross30    []CurAmount    `json:"gross30"`   // what buyers paid, last 30 days
	Studio30   []CurAmount    `json:"studio30"`  // the studios' share, last 30 days
	Buyers30   int            `json:"buyers30"`  // accounts that paid for anything, last 30 days
	Members    int            `json:"members"`   // open accounts
	Paying     map[string]int `json:"paying"`    // active paid plans by plan
	Milestones []Milestone    `json:"milestones"`
	CanEdit    bool           `json:"canEdit"`
}

// CanInvest is who sees the investor view: the CEO, the CFO and investors.
func (st Store) CanInvest(ctx context.Context, email string) error {
	return st.allowed(ctx, email, "cfo", "investor")
}

func sums(ctx context.Context, q pgx.Tx, sql string, args ...any) ([]CurAmount, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (CurAmount, error) {
		var c CurAmount
		return c, r.Scan(&c.Currency, &c.Minor)
	})
}

func (st Store) Investor(ctx context.Context, email string, now time.Time) (Investor, error) {
	in := Investor{Months: []MonthNet{}, Paying: map[string]int{}, Milestones: []Milestone{}}
	if err := st.CanInvest(ctx, email); err != nil {
		return in, err
	}
	in.CanEdit = st.ceo(email)
	tx, err := st.DB.Begin(ctx)
	if err != nil {
		return in, err
	}
	defer tx.Rollback(ctx)
	lagos := time.FixedZone("WAT", 3600)
	l := now.In(lagos)
	first := time.Date(l.Year(), l.Month(), 1, 0, 0, 0, 0, lagos).AddDate(0, -11, 0)
	rows, err := tx.Query(ctx, `WITH b AS (`+bookings+`)
	  SELECT to_char(at AT TIME ZONE 'Africa/Lagos', 'YYYY-MM'), cur, sum(net)::bigint FROM b WHERE at >= $1 AND at < $2 AND $3::timestamptz IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2`, first, now, now)
	if err != nil {
		return in, err
	}
	if in.Months, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (MonthNet, error) {
		var m MonthNet
		return m, r.Scan(&m.Month, &m.Currency, &m.Net)
	}); err != nil {
		return in, err
	}
	from := now.AddDate(0, 0, -30)
	q := `WITH b AS (` + bookings + `) SELECT cur, sum(COLUMN)::bigint FROM b WHERE at >= $1 AND at < $2 AND $3::timestamptz IS NOT NULL GROUP BY 1 ORDER BY 1`
	if in.Net30, err = sums(ctx, tx, strings.Replace(q, "COLUMN", "net", 1), from, now, now); err != nil {
		return in, err
	}
	if in.NetPrev30, err = sums(ctx, tx, strings.Replace(q, "COLUMN", "net", 1), from.AddDate(-1, 0, 0), now.AddDate(-1, 0, 0), now); err != nil {
		return in, err
	}
	if in.Gross30, err = sums(ctx, tx, strings.Replace(q, "COLUMN", "gross", 1), from, now, now); err != nil {
		return in, err
	}
	// The studios' share: everything a studio ticket or gift paid that E-Cinema did not keep.
	if in.Studio30, err = sums(ctx, tx, `WITH b AS (`+bookings+`) SELECT cur, sum(gross - net)::bigint FROM b
	  WHERE source IN ('tickets', 'presales', 'gifts') AND at >= $1 AND at < $2 AND $3::timestamptz IS NOT NULL GROUP BY 1 ORDER BY 1`, from, now, now); err != nil {
		return in, err
	}
	if err := tx.QueryRow(ctx, `WITH b AS (`+bookings+`) SELECT
	    (SELECT count(DISTINCT acct) FROM b WHERE at >= $1 AND at < $2 AND $3::timestamptz IS NOT NULL)::int,
	    (SELECT count(*) FROM accounts WHERE banned_at IS NULL AND delete_after IS NULL)::int`, from, now, now).Scan(&in.Buyers30, &in.Members); err != nil {
		return in, err
	}
	rows, err = tx.Query(ctx, `SELECT plan, count(*)::int FROM accounts WHERE plan <> 'free' AND plan_status = 'active' AND banned_at IS NULL
	  AND (paypal_subscription_id IS NOT NULL OR plan_gift_until > $1) GROUP BY 1`, now)
	if err != nil {
		return in, err
	}
	for rows.Next() {
		var p string
		var n int
		if err := rows.Scan(&p, &n); err != nil {
			rows.Close()
			return in, err
		}
		in.Paying[p] = n
	}
	rows.Close()
	if in.Milestones, err = milestones(ctx, tx); err != nil {
		return in, err
	}
	return in, tx.Commit(ctx)
}

func milestones(ctx context.Context, tx pgx.Tx) ([]Milestone, error) {
	rows, err := tx.Query(ctx, `SELECT id, quarter, title, done FROM investor_milestones
	  ORDER BY split_part(quarter, ' ', 2), quarter, id`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Milestone, error) {
		var m Milestone
		return m, r.Scan(&m.ID, &m.Quarter, &m.Title, &m.Done)
	})
}

// SaveMilestone adds (id 0) or updates a milestone; Delete removes it. The CEO only.
func (st Store) SaveMilestone(ctx context.Context, email string, m Milestone) (Milestone, error) {
	if !st.ceo(email) {
		return m, ErrForbidden
	}
	m.Quarter, m.Title = strings.ToUpper(strings.TrimSpace(m.Quarter)), strings.TrimSpace(m.Title)
	if n := utf8.RuneCountInString(m.Title); n < 3 || n > 140 || len(m.Quarter) != 7 || m.Quarter[0] != 'Q' || m.Quarter[1] < '1' || m.Quarter[1] > '4' || m.Quarter[2] != ' ' {
		return m, fmt.Errorf("%w: a quarter like Q1 2027 and a title of 3 to 140 characters", ErrBadInput)
	}
	if m.ID == 0 {
		err := st.DB.QueryRow(ctx, `INSERT INTO investor_milestones (quarter, title, done) VALUES ($1, $2, $3) RETURNING id`, m.Quarter, m.Title, m.Done).Scan(&m.ID)
		if err != nil && strings.Contains(err.Error(), "check constraint") {
			return m, fmt.Errorf("%w: a quarter like Q1 2027", ErrBadInput)
		}
		return m, err
	}
	tag, err := st.DB.Exec(ctx, `UPDATE investor_milestones SET quarter = $2, title = $3, done = $4 WHERE id = $1`, m.ID, m.Quarter, m.Title, m.Done)
	if err == nil && tag.RowsAffected() == 0 {
		return m, ErrNotFound
	}
	if err != nil && strings.Contains(err.Error(), "check constraint") {
		return m, fmt.Errorf("%w: a quarter like Q1 2027", ErrBadInput)
	}
	return m, err
}

func (st Store) DeleteMilestone(ctx context.Context, email string, id int64) error {
	if !st.ceo(email) {
		return ErrForbidden
	}
	_, err := st.DB.Exec(ctx, `DELETE FROM investor_milestones WHERE id = $1`, id)
	return err
}
