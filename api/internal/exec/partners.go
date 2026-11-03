package exec

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// Partners view (Figma 51:198): a partner sees only their own deal. Payment partners see the
// seat payments that went through them; carrier billing has no integration yet, so it says Soon.

type Deal struct {
	Email    string   `json:"email"`
	Name     string   `json:"name"`
	Org      string   `json:"org"`
	Kind     string   `json:"kind"`
	Provider string   `json:"provider"`
	Summary  string   `json:"summary"`
	Plan     []string `json:"plan"`
}

type PartnerStats struct {
	Paid      int            `json:"paid"`      // this month
	PaidPrev  int            `json:"paidPrev"`  // last month
	Tried     int            `json:"tried"`     // checkouts that reached them this month
	Refunded  int            `json:"refunded"`  // this month
	Volume    []CurAmount    `json:"volume"`    // what buyers paid through them this month
	Countries map[string]int `json:"countries"` // paid seats by buyer country, this month
}

type Partner struct {
	Deal    *Deal         `json:"deal"`  // nil when the CEO has not set one up for this partner
	Stats   *PartnerStats `json:"stats"` // payment partners only
	Deals   []Deal        `json:"deals"` // the CEO's list
	CanEdit bool          `json:"canEdit"`
}

var providerPrefix = map[string]string{"paystack": "PSK-%", "flutterwave": "FLW-%"}

func (st Store) deal(ctx context.Context, email string) (*Deal, error) {
	var d Deal
	err := st.DB.QueryRow(ctx, `SELECT d.email, e.name, e.org, d.kind, d.provider, d.summary, d.plan FROM partner_deals d JOIN executives e ON e.email = d.email WHERE d.email = lower($1)`, email).
		Scan(&d.Email, &d.Name, &d.Org, &d.Kind, &d.Provider, &d.Summary, &d.Plan)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &d, err
}

// Partner returns the view for a partner, or for the CEO previewing one (as, may be empty).
func (st Store) Partner(ctx context.Context, email, as string, now time.Time) (Partner, error) {
	p := Partner{Deals: []Deal{}}
	if err := st.allowed(ctx, email, "partner"); err != nil {
		return p, err
	}
	who := email
	if st.ceo(email) {
		p.CanEdit = true
		rows, err := st.DB.Query(ctx, `SELECT e.email, e.name, e.org, coalesce(d.kind, ''), coalesce(d.provider, ''), coalesce(d.summary, ''), coalesce(d.plan, '{}')
		  FROM executives e LEFT JOIN partner_deals d ON d.email = e.email WHERE e.role = 'partner' ORDER BY e.org, e.email`)
		if err != nil {
			return p, err
		}
		if p.Deals, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Deal, error) {
			var d Deal
			return d, r.Scan(&d.Email, &d.Name, &d.Org, &d.Kind, &d.Provider, &d.Summary, &d.Plan)
		}); err != nil {
			return p, err
		}
		who = as
		if who == "" {
			return p, nil
		}
	}
	d, err := st.deal(ctx, who)
	if err != nil || d == nil {
		return p, err
	}
	p.Deal = d
	if d.Kind != "payments" || d.Provider == "" {
		return p, nil
	}
	// PayPal orders carry no prefix: anything that is not Paystack or Flutterwave.
	match := `paypal_order_id NOT LIKE 'PSK-%' AND paypal_order_id NOT LIKE 'FLW-%'`
	if pre, ok := providerPrefix[d.Provider]; ok {
		match = fmt.Sprintf(`paypal_order_id LIKE '%s'`, pre)
	}
	month := monthStart(now)
	prev := month.AddDate(0, -1, 0)
	s := PartnerStats{Countries: map[string]int{}}
	base := `FROM holds h JOIN showtimes sh ON sh.id = h.showtime_id LEFT JOIN accounts a ON a.id = h.account_id
	  WHERE h.paypal_order_id IS NOT NULL AND coalesce(h.paypal_capture_id, '') NOT LIKE 'CREDIT-%' AND ` + strings.ReplaceAll(match, "paypal_order_id", "h.paypal_order_id")
	if err := st.DB.QueryRow(ctx, `SELECT count(*) FILTER (WHERE h.status IN ('paid', 'refunded') AND h.created_at >= $1)::int,
	    count(*) FILTER (WHERE h.status IN ('paid', 'refunded') AND h.created_at >= $2 AND h.created_at < $1)::int,
	    count(*) FILTER (WHERE h.created_at >= $1)::int, count(*) FILTER (WHERE h.status = 'refunded' AND h.created_at >= $1)::int `+base,
		month, prev).Scan(&s.Paid, &s.PaidPrev, &s.Tried, &s.Refunded); err != nil {
		return p, err
	}
	rows, err := st.DB.Query(ctx, `SELECT sh.currency::text, sum(coalesce(h.net_cents, h.seats * sh.price_cents))::bigint `+base+` AND h.status = 'paid' AND h.created_at >= $1 GROUP BY 1 ORDER BY 1`, month)
	if err != nil {
		return p, err
	}
	if s.Volume, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (CurAmount, error) {
		var c CurAmount
		return c, r.Scan(&c.Currency, &c.Minor)
	}); err != nil {
		return p, err
	}
	rows, err = st.DB.Query(ctx, `SELECT coalesce(nullif(upper(trim(a.country)), ''), '??'), sum(h.seats)::int `+base+` AND h.status = 'paid' AND h.created_at >= $1 GROUP BY 1`, month)
	if err != nil {
		return p, err
	}
	for rows.Next() {
		var cc string
		var n int
		if err := rows.Scan(&cc, &n); err != nil {
			rows.Close()
			return p, err
		}
		s.Countries[cc] = n
	}
	rows.Close()
	p.Stats = &s
	return p, rows.Err()
}

// SaveDeal sets a partner's deal. The CEO only; the partner must already have the partner role.
func (st Store) SaveDeal(ctx context.Context, email string, d Deal) error {
	if !st.ceo(email) {
		return ErrForbidden
	}
	d.Email, d.Summary = strings.ToLower(strings.TrimSpace(d.Email)), strings.TrimSpace(d.Summary)
	if d.Kind != "payments" && d.Kind != "carrier" && d.Kind != "other" {
		return fmt.Errorf("%w: pick the kind of partner", ErrBadInput)
	}
	if d.Kind != "payments" {
		d.Provider = ""
	} else if d.Provider != "paypal" && d.Provider != "paystack" && d.Provider != "flutterwave" {
		return fmt.Errorf("%w: pick the payment provider", ErrBadInput)
	}
	plan := []string{}
	for _, x := range d.Plan {
		if x = strings.TrimSpace(x); x != "" {
			if utf8.RuneCountInString(x) > 140 {
				return fmt.Errorf("%w: keep each plan line under 140 characters", ErrBadInput)
			}
			plan = append(plan, x)
		}
	}
	if len(plan) > 8 || utf8.RuneCountInString(d.Summary) > 200 {
		return fmt.Errorf("%w: up to 8 plan lines and a short summary", ErrBadInput)
	}
	tag, err := st.DB.Exec(ctx, `INSERT INTO partner_deals (email, kind, provider, summary, plan)
	  SELECT email, $2, $3, $4, $5 FROM executives WHERE email = $1 AND role = 'partner'
	  ON CONFLICT (email) DO UPDATE SET kind = $2, provider = $3, summary = $4, plan = $5, updated_at = now()`, d.Email, d.Kind, d.Provider, d.Summary, plan)
	if err == nil && tag.RowsAffected() == 0 {
		return fmt.Errorf("%w: add them as a partner on Access and roles first", ErrNotFound)
	}
	return err
}
