package exec

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// Money (Figma 50:253): bookings by source, region and payment provider over a period, with the
// period before it, in each original currency (minor units). The web converts to US dollars.

type MoneyRow struct {
	Source   string `json:"source"`
	Currency string `json:"currency"`
	Gross    int64  `json:"gross"`
	Net      int64  `json:"net"`
	Prev     bool   `json:"prev"` // the period before
}

type RegionRow struct {
	Country  string `json:"country"`
	Currency string `json:"currency"`
	Net      int64  `json:"net"`
}

type ProviderRow struct {
	Provider  string   `json:"provider"`
	Currency  string   `json:"currency"`
	Volume    int64    `json:"volume"`
	Paid      int      `json:"paid"`
	Tried     int      `json:"tried"`
	Refunded  int      `json:"refunded"`
	Countries []string `json:"countries"`
}

type Amount struct {
	What     string `json:"what"`
	Currency string `json:"currency"`
	Minor    int64  `json:"minor"`
}

type Money struct {
	Days      int           `json:"days"`
	Rows      []MoneyRow    `json:"rows"`
	Regions   []RegionRow   `json:"regions"`
	Providers []ProviderRow `json:"providers"`
	Refunds   [4]int        `json:"refunds"` // refunded, paid, and the same for the period before
	Out       []Amount      `json:"out"`     // money out since the 1st of this month (Lagos)
}

// Who may see money: the CEO, the CFO and anyone the CEO switched "Can see money" on for.
func (st Store) moneyAccess(ctx context.Context, email string) (bool, error) {
	if st.ceo(email) {
		return true, nil
	}
	var role string
	var can bool
	err := st.DB.QueryRow(ctx, `SELECT role, can_money FROM executives WHERE email = lower($1) AND NOT pending AND (expires_on IS NULL OR expires_on >= (now() AT TIME ZONE 'Africa/Lagos')::date)`, email).Scan(&role, &can)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	return role == "cfo" || can, err
}

// CanSeeMoney says whether the Money page is open to this person.
func (st Store) CanSeeMoney(ctx context.Context, email string) (bool, error) {
	return st.moneyAccess(ctx, email)
}

// Every paid booking as (source, currency, gross, net, created, account, provider) rows.
// Seats paid from credit are left out: that money was counted when the gift or refund credit
// was bought. 18+ stage payments go to the charity, church and mosque funds, so E-Cinema nets
// nothing from them; studio tickets net E-Cinema's 30%.
const bookings = `
  SELECT CASE WHEN s.starts_at > $3 THEN 'presales' ELSE 'tickets' END AS source, s.currency::text AS cur,
    coalesce(h.net_cents, h.seats * s.price_cents)::bigint AS gross, (coalesce(h.net_cents, h.seats * s.price_cents) * 30 / 100)::bigint AS net,
    h.created_at AS at, h.account_id AS acct,
    CASE WHEN h.paypal_order_id LIKE 'PSK-%' THEN 'paystack' WHEN h.paypal_order_id LIKE 'FLW-%' THEN 'flutterwave' ELSE 'paypal' END AS provider
  FROM holds h JOIN showtimes s ON s.id = h.showtime_id
  WHERE h.status = 'paid' AND h.paypal_order_id IS NOT NULL AND coalesce(h.paypal_capture_id, '') NOT LIKE 'CREDIT-%' AND NOT h.lottery
  UNION ALL SELECT 'shop', 'NGN', total_ngn::bigint * 100, total_ngn::bigint * 100, coalesce(placed_at, created_at), account_id, CASE WHEN method = 'cod' THEN 'cash' ELSE 'paypal' END
  FROM shop_orders WHERE placed_at IS NOT NULL AND cancelled_at IS NULL AND returned_at IS NULL AND (method = 'paypal' OR delivered_at IS NOT NULL)
  UNION ALL SELECT 'adult', currency, amount_cents, 0, paid_at, account_id, 'paypal' FROM adult_stages WHERE status = 'paid' AND paid_at IS NOT NULL
  UNION ALL SELECT 'gifts', currency, amount_cents, amount_cents * 30 / 100, created_at, giver_id, 'paypal' FROM gifts WHERE status IN ('paid', 'redeemed')
  UNION ALL SELECT 'library', currency::text, amount_cents, amount_cents, paid_at, account_id, 'paypal' FROM library_keeps WHERE status = 'paid' AND paid_at IS NOT NULL
  UNION ALL SELECT 'licences', 'NGN', fee_ngn::bigint * 100, fee_ngn::bigint * 100, paid_at, account_id, 'paypal' FROM licence_applications WHERE paid_at IS NOT NULL AND fee_ngn > 0
  UNION ALL SELECT 'licences', 'NGN', fee_ngn::bigint * 100, fee_ngn::bigint * 100, paid_at, account_id, 'paypal' FROM licence_renewals WHERE paid_at IS NOT NULL AND fee_ngn > 0`

func (st Store) Money(ctx context.Context, email string, days int, now time.Time) (Money, error) {
	m := Money{Days: days, Rows: []MoneyRow{}, Regions: []RegionRow{}, Providers: []ProviderRow{}, Out: []Amount{}}
	ok, err := st.moneyAccess(ctx, email)
	if err != nil {
		return m, err
	}
	if !ok {
		return m, ErrForbidden
	}
	if days != 30 && days != 90 && days != 365 {
		days = 30
		m.Days = 30
	}
	from := now.AddDate(0, 0, -days)
	prev := from.AddDate(0, 0, -days)
	rows, err := st.DB.Query(ctx, `WITH b AS (`+bookings+`)
	  SELECT source, cur, sum(gross)::bigint, sum(net)::bigint, at < $1 FROM b WHERE at >= $2 AND at < $3 GROUP BY 1, 2, 5 ORDER BY 1, 2`, from, prev, now)
	if err != nil {
		return m, err
	}
	if m.Rows, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (MoneyRow, error) {
		var x MoneyRow
		return x, r.Scan(&x.Source, &x.Currency, &x.Gross, &x.Net, &x.Prev)
	}); err != nil {
		return m, err
	}
	rows, err = st.DB.Query(ctx, `WITH b AS (`+bookings+`)
	  SELECT coalesce(nullif(trim(a.country), ''), '??'), b.cur, sum(b.net)::bigint FROM b LEFT JOIN accounts a ON a.id = b.acct
	  WHERE b.at >= $1 AND b.at < $3 AND $2::timestamptz IS NOT NULL GROUP BY 1, 2`, from, prev, now)
	if err != nil {
		return m, err
	}
	if m.Regions, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (RegionRow, error) {
		var x RegionRow
		return x, r.Scan(&x.Country, &x.Currency, &x.Net)
	}); err != nil {
		return m, err
	}
	// Providers: volume and buyer countries from paid bookings; success from every checkout that
	// reached a provider (seat holds with an order attached), refunds from refunded seats.
	rows, err = st.DB.Query(ctx, `WITH b AS (`+bookings+`), v AS (
	    SELECT b.provider, b.cur, sum(b.gross)::bigint AS vol, array_agg(DISTINCT trim(a.country)) FILTER (WHERE coalesce(trim(a.country), '') <> '') AS cc
	    FROM b LEFT JOIN accounts a ON a.id = b.acct WHERE b.at >= $1 AND b.at < $2 GROUP BY 1, 2),
	  t AS (SELECT CASE WHEN paypal_order_id LIKE 'PSK-%' THEN 'paystack' WHEN paypal_order_id LIKE 'FLW-%' THEN 'flutterwave' ELSE 'paypal' END AS provider,
	      count(*) FILTER (WHERE status IN ('paid', 'refunded'))::int AS paid, count(*)::int AS tried, count(*) FILTER (WHERE status = 'refunded')::int AS refunded
	    FROM holds WHERE paypal_order_id IS NOT NULL AND coalesce(paypal_capture_id, '') NOT LIKE 'CREDIT-%' AND created_at >= $1 AND created_at < $2 GROUP BY 1)
	  SELECT coalesce(v.provider, t.provider), coalesce(v.cur, ''), coalesce(v.vol, 0), coalesce(t.paid, 0), coalesce(t.tried, 0), coalesce(t.refunded, 0), coalesce(v.cc, '{}')
	  FROM v FULL JOIN t ON t.provider = v.provider ORDER BY 1, 2`, from, now, now)
	if err != nil {
		return m, err
	}
	if m.Providers, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (ProviderRow, error) {
		var x ProviderRow
		return x, r.Scan(&x.Provider, &x.Currency, &x.Volume, &x.Paid, &x.Tried, &x.Refunded, &x.Countries)
	}); err != nil {
		return m, err
	}
	if err := st.DB.QueryRow(ctx, `SELECT count(*) FILTER (WHERE status = 'refunded' AND created_at >= $1)::int, count(*) FILTER (WHERE created_at >= $1)::int,
	    count(*) FILTER (WHERE status = 'refunded' AND created_at < $1)::int, count(*) FILTER (WHERE created_at < $1)::int
	  FROM holds WHERE status IN ('paid', 'refunded') AND paypal_order_id IS NOT NULL AND created_at >= $2 AND created_at < $3`, from, prev, now).Scan(&m.Refunds[0], &m.Refunds[1], &m.Refunds[2], &m.Refunds[3]); err != nil {
		return m, err
	}
	// Money out this month: studio payouts sent, and what the 18+ funds are owed.
	lagos := time.FixedZone("WAT", 3600)
	l := now.In(lagos)
	month := time.Date(l.Year(), l.Month(), 1, 0, 0, 0, 0, lagos)
	rows, err = st.DB.Query(ctx, `SELECT 'studios', currency::text, sum(studio_cents)::bigint FROM studio_payouts WHERE status = 'sent' AND updated_at >= $1 GROUP BY 2
	  UNION ALL SELECT 'recipients', currency, sum(amount_cents)::bigint FROM adult_stages WHERE status = 'paid' AND paid_at >= $1 GROUP BY 2`, month)
	if err != nil {
		return m, err
	}
	m.Out, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Amount, error) {
		var x Amount
		return x, r.Scan(&x.What, &x.Currency, &x.Minor)
	})
	return m, err
}
