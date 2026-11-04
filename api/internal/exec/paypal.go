package exec

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// PayPal and AI agents (Figma 285:373): money that went through PayPal, the share the AI
// concierge booked, refunds, disputes from the webhook, revenue by film and the payment watch
// checks. Open to the CEO, the CFO and anyone allowed to see money. Amounts are per currency in
// minor units; the web converts them to USD.

type CurMinor struct {
	Currency string `json:"currency"`
	Minor    int64  `json:"minor"`
}

type PayPalBucket struct {
	Start    string `json:"start"`   // first day, YYYY-MM-DD
	Product  string `json:"product"` // checkout or donations
	Currency string `json:"currency"`
	Minor    int64  `json:"minor"`
}

type PayFilm struct {
	Film     string `json:"film"`
	Studio   string `json:"studio"`
	Seats    int    `json:"seats"`
	Currency string `json:"currency"`
	Gross    int64  `json:"gross"` // PayPal-paid seats only
	Refunded int    `json:"refunded"`
	Disputes int    `json:"disputes"`
}

type WatchAlert struct {
	Tone  string `json:"tone"` // amber, red, green
	Title string `json:"title"`
	Body  string `json:"body"`
	Href  string `json:"href,omitempty"`
}

type PayPalPage struct {
	Days            int            `json:"days"`
	Revenue         []CurMinor     `json:"revenue"`
	RevenuePrev     []CurMinor     `json:"revenuePrev"`
	Orders          int            `json:"orders"`
	ConciergeOrders int            `json:"conciergeOrders"`
	ConciergeHolds  int            `json:"conciergeHolds"` // all concierge holds, paid or not
	Refunded        int            `json:"refunded"`
	RefundedPrev    int            `json:"refundedPrev"`
	PaidPrev        int            `json:"paidPrev"`
	DisputesOpen    int            `json:"disputesOpen"`
	DisputesStake   []CurMinor     `json:"disputesStake"`
	DisputesDue48   int            `json:"disputesDue48"`
	Buckets         []PayPalBucket `json:"buckets"`
	Monthly         bool           `json:"monthly"`
	Films           []PayFilm      `json:"films"`
	Watch           []WatchAlert   `json:"watch"`
}

// PayPal-paid money: seats not paid through Paystack, Flutterwave or credit, PayPal shop orders,
// gifts, kept films, licence fees, and 18+ stage payments (PayPal Donations to the funds).
const paypalMoney = `
  SELECT 'checkout' AS product, s.currency::text AS cur, coalesce(h.net_cents, h.seats * s.price_cents)::bigint AS minor, h.created_at AS at
  FROM holds h JOIN showtimes s ON s.id = h.showtime_id
  WHERE h.status IN ('paid', 'refunded') AND h.paypal_order_id IS NOT NULL AND h.paypal_order_id NOT LIKE 'PSK-%' AND h.paypal_order_id NOT LIKE 'FLW-%'
    AND coalesce(h.paypal_capture_id, '') NOT LIKE 'CREDIT-%' AND NOT h.lottery AND h.status = 'paid'
  UNION ALL SELECT 'checkout', 'NGN', total_ngn::bigint * 100, coalesce(placed_at, created_at) FROM shop_orders WHERE placed_at IS NOT NULL AND method = 'paypal' AND cancelled_at IS NULL AND returned_at IS NULL
  UNION ALL SELECT 'checkout', currency, amount_cents, created_at FROM gifts WHERE status IN ('paid', 'redeemed')
  UNION ALL SELECT 'checkout', currency::text, amount_cents, paid_at FROM library_keeps WHERE status = 'paid' AND paid_at IS NOT NULL
  UNION ALL SELECT 'checkout', 'NGN', fee_ngn::bigint * 100, paid_at FROM licence_applications WHERE paid_at IS NOT NULL AND fee_ngn > 0
  UNION ALL SELECT 'checkout', 'NGN', fee_ngn::bigint * 100, paid_at FROM licence_renewals WHERE paid_at IS NOT NULL AND fee_ngn > 0
  UNION ALL SELECT 'donations', currency, amount_cents, paid_at FROM adult_stages WHERE status = 'paid' AND paid_at IS NOT NULL`

// PayPal seats: paid through PayPal (not Paystack, Flutterwave, credit or the lottery).
const paypalSeat = `h.paypal_order_id IS NOT NULL AND h.paypal_order_id NOT LIKE 'PSK-%' AND h.paypal_order_id NOT LIKE 'FLW-%'
  AND coalesce(h.paypal_capture_id, '') NOT LIKE 'CREDIT-%' AND NOT h.lottery`

func curSums(rows pgx.Rows) ([]CurMinor, error) {
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (CurMinor, error) {
		var c CurMinor
		return c, r.Scan(&c.Currency, &c.Minor)
	})
}

func (st Store) PayPal(ctx context.Context, email string, days int, now time.Time) (PayPalPage, error) {
	p := PayPalPage{Revenue: []CurMinor{}, RevenuePrev: []CurMinor{}, DisputesStake: []CurMinor{}, Buckets: []PayPalBucket{}, Films: []PayFilm{}, Watch: []WatchAlert{}}
	ok, err := st.moneyAccess(ctx, email)
	if err != nil {
		return p, err
	}
	if !ok {
		return p, ErrForbidden
	}
	if days != 30 && days != 90 && days != 365 {
		days = 30
	}
	p.Days = days
	from := now.AddDate(0, 0, -days)
	prev := from.AddDate(0, 0, -days)
	rows, err := st.DB.Query(ctx, `WITH m AS (`+paypalMoney+`) SELECT cur, sum(minor)::bigint FROM m WHERE at >= $1 AND at < $2 GROUP BY 1 ORDER BY 1`, from, now)
	if err != nil {
		return p, err
	}
	if p.Revenue, err = curSums(rows); err != nil {
		return p, err
	}
	rows, err = st.DB.Query(ctx, `WITH m AS (`+paypalMoney+`) SELECT cur, sum(minor)::bigint FROM m WHERE at >= $1 AND at < $2 GROUP BY 1 ORDER BY 1`, prev, from)
	if err != nil {
		return p, err
	}
	if p.RevenuePrev, err = curSums(rows); err != nil {
		return p, err
	}
	// Orders, concierge share and refunds count PayPal seat orders.
	err = st.DB.QueryRow(ctx, `SELECT
	    count(*) FILTER (WHERE h.created_at >= $1 AND h.status IN ('paid', 'refunded')),
	    count(*) FILTER (WHERE h.created_at >= $1 AND h.status IN ('paid', 'refunded') AND h.via = 'concierge'),
	    count(*) FILTER (WHERE h.created_at >= $1 AND h.status = 'refunded'),
	    count(*) FILTER (WHERE h.created_at >= $2 AND h.created_at < $1 AND h.status = 'refunded'),
	    count(*) FILTER (WHERE h.created_at >= $2 AND h.created_at < $1 AND h.status IN ('paid', 'refunded'))
	  FROM holds h WHERE `+paypalSeat+` AND h.created_at >= $2 AND h.created_at < $3`, from, prev, now).
		Scan(&p.Orders, &p.ConciergeOrders, &p.Refunded, &p.RefundedPrev, &p.PaidPrev)
	if err != nil {
		return p, err
	}
	if err = st.DB.QueryRow(ctx, `SELECT count(*) FROM holds WHERE via = 'concierge' AND created_at >= $1 AND created_at < $2`, from, now).Scan(&p.ConciergeHolds); err != nil {
		return p, err
	}
	err = st.DB.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE due_at IS NOT NULL AND due_at < $1) FROM paypal_disputes WHERE resolved_at IS NULL`, now.Add(48*time.Hour)).
		Scan(&p.DisputesOpen, &p.DisputesDue48)
	if err != nil {
		return p, err
	}
	rows, err = st.DB.Query(ctx, `SELECT currency, sum(amount_cents)::bigint FROM paypal_disputes WHERE resolved_at IS NULL GROUP BY 1 ORDER BY 1`)
	if err != nil {
		return p, err
	}
	if p.DisputesStake, err = curSums(rows); err != nil {
		return p, err
	}
	// Weekly buckets (monthly for a year), Lagos time.
	unit := "week"
	if days == 365 {
		unit, p.Monthly = "month", true
	}
	rows, err = st.DB.Query(ctx, `WITH m AS (`+paypalMoney+`)
	  SELECT to_char(date_trunc('`+unit+`', at AT TIME ZONE 'Africa/Lagos'), 'YYYY-MM-DD'), product, cur, sum(minor)::bigint FROM m WHERE at >= $1 AND at < $2 GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`, from, now)
	if err != nil {
		return p, err
	}
	if p.Buckets, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (PayPalBucket, error) {
		var b PayPalBucket
		return b, r.Scan(&b.Start, &b.Product, &b.Currency, &b.Minor)
	}); err != nil {
		return p, err
	}
	rows, err = st.DB.Query(ctx, `SELECT s.film, s.studio, s.currency::text,
	    coalesce(sum(h.seats) FILTER (WHERE h.status = 'paid'), 0)::int,
	    coalesce(sum(coalesce(h.net_cents, h.seats * s.price_cents)) FILTER (WHERE h.status = 'paid'), 0)::bigint,
	    coalesce(sum(h.seats) FILTER (WHERE h.status = 'refunded'), 0)::int,
	    count(DISTINCT d.id)::int
	  FROM holds h JOIN showtimes s ON s.id = h.showtime_id LEFT JOIN paypal_disputes d ON d.capture_id <> '' AND d.capture_id = h.paypal_capture_id
	  WHERE `+paypalSeat+` AND h.status IN ('paid', 'refunded') AND h.created_at >= $1 AND h.created_at < $2
	  GROUP BY 1, 2, 3 ORDER BY 5 DESC LIMIT 50`, from, now)
	if err != nil {
		return p, err
	}
	if p.Films, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (PayFilm, error) {
		var f PayFilm
		return f, r.Scan(&f.Film, &f.Studio, &f.Currency, &f.Seats, &f.Gross, &f.Refunded, &f.Disputes)
	}); err != nil {
		return p, err
	}
	p.Watch, err = st.paymentWatch(ctx, now, p)
	return p, err
}

// paymentWatch runs the payment watch checks: refund spikes by country, failed studio payouts
// and disputes close to PayPal's reply deadline. Quiet days say so.
func (st Store) paymentWatch(ctx context.Context, now time.Time, p PayPalPage) ([]WatchAlert, error) {
	out := []WatchAlert{}
	rows, err := st.DB.Query(ctx, `SELECT coalesce(a.country, ''), count(*) FILTER (WHERE h.refunded_at >= $1)::int,
	    count(*) FILTER (WHERE h.refunded_at >= $2 AND h.refunded_at < $1)::int
	  FROM holds h LEFT JOIN accounts a ON a.id = h.account_id WHERE h.status = 'refunded' AND h.refunded_at >= $2
	  GROUP BY 1`, now.Add(-24*time.Hour), now.AddDate(0, 0, -30))
	if err != nil {
		return out, err
	}
	type spike struct {
		cc        string
		day, base int
	}
	var spikes []spike
	for rows.Next() {
		var s spike
		if err := rows.Scan(&s.cc, &s.day, &s.base); err != nil {
			rows.Close()
			return out, err
		}
		// A spike: at least 3 refunds today and 3x the daily average of the 29 days before.
		if s.day >= 3 && float64(s.day) >= 3*float64(s.base)/29 {
			spikes = append(spikes, s)
		}
	}
	rows.Close()
	for _, s := range spikes {
		where := s.cc
		if where == "" {
			where = "no country set"
		}
		times := "new"
		if s.base > 0 {
			times = fmt.Sprintf("%.0fx normal", float64(s.day)/(float64(s.base)/29))
		}
		out = append(out, WatchAlert{Tone: "amber", Title: "Refund spike · " + where, Body: fmt.Sprintf("%d seat refunds in the last 24 hours, %s. Check the rooms that played there for a stream problem.", s.day, times), Href: "/executive/live"})
	}
	var failed int
	var studios []string
	if err := st.DB.QueryRow(ctx, `SELECT count(*), coalesce(array_agg(DISTINCT studio) FILTER (WHERE studio IS NOT NULL), '{}') FROM studio_payouts WHERE status = 'failed'`).Scan(&failed, &studios); err != nil {
		return out, err
	}
	if failed > 0 {
		out = append(out, WatchAlert{Tone: "red", Title: fmt.Sprintf("Failed payouts · %d studio%s", len(studios), map[bool]string{true: "", false: "s"}[len(studios) == 1]),
			Body: fmt.Sprintf("PayPal could not pay %s. The next sweep retries once the payout email is fixed.", strings.Join(studios, ", ")), Href: "/studio/desk"})
	}
	if p.DisputesDue48 > 0 {
		out = append(out, WatchAlert{Tone: "red", Title: fmt.Sprintf("%d dispute%s due in 48 hours", p.DisputesDue48, map[bool]string{true: "", false: "s"}[p.DisputesDue48 == 1]), Body: "Answer them in the PayPal Resolution Center before the deadline, or PayPal decides for the buyer."})
	}
	if len(out) == 0 {
		out = append(out, WatchAlert{Tone: "green", Title: "All quiet", Body: "No refund spikes, failed studio payouts or disputes close to their deadline."})
	}
	return out, nil
}

// SaveDispute records a PayPal dispute from the webhook (created, updated or resolved).
func (st Store) SaveDispute(ctx context.Context, id, captureID, currency, reason, status, outcome string, amount int64, due *time.Time, resolved bool, now time.Time) error {
	if id == "" || len(id) > 64 {
		return ErrBadInput
	}
	var res *time.Time
	if resolved {
		res = &now
	}
	_, err := st.DB.Exec(ctx, `INSERT INTO paypal_disputes (id, capture_id, amount_cents, currency, reason, status, due_at, outcome, resolved_at, updated_at)
	  VALUES ($1, $2, $3, coalesce(nullif($4, ''), 'USD'), $5, $6, $7, $8, $9, $10)
	  ON CONFLICT (id) DO UPDATE SET capture_id = coalesce(nullif($2, ''), paypal_disputes.capture_id), amount_cents = CASE WHEN $3 > 0 THEN $3 ELSE paypal_disputes.amount_cents END,
	    reason = coalesce(nullif($5, ''), paypal_disputes.reason), status = $6, due_at = coalesce($7, paypal_disputes.due_at), outcome = coalesce(nullif($8, ''), paypal_disputes.outcome),
	    resolved_at = coalesce($9, paypal_disputes.resolved_at), updated_at = $10`,
		id, captureID, amount, strings.ToUpper(currency), reason, strings.ToUpper(status), due, outcome, res, now)
	return err
}

// MarkConcierge tags a seat hold the AI concierge made, for the concierge share.
func (st Store) MarkConcierge(ctx context.Context, holdID string) error {
	_, err := st.DB.Exec(ctx, `UPDATE holds SET via = 'concierge' WHERE id::text = $1`, holdID)
	return err
}
