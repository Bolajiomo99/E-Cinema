package licensing

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Royalties are due by the 5th of the month after the sales (the compliance score counts a
// settlement as on time until then).
func RoyaltyDueBy(month time.Time) time.Time { return month.AddDate(0, 1, 4) }

// InvoiceNo names a month's royalty invoice: licence NG-0042, October → INV-0042-10.
func InvoiceNo(licence string, month time.Time) string {
	n := licence
	if i := strings.LastIndexByte(licence, '-'); i >= 0 {
		n = licence[i+1:]
	}
	return fmt.Sprintf("INV-%s-%02d", n, int(month.Month()))
}

// RoyaltyQuote is what a past, unsettled month owes.
type RoyaltyQuote struct {
	Month      string `json:"month"`
	Invoice    string `json:"invoice"`
	SalesNGN   int64  `json:"salesNgn"`
	RoyaltyNGN int64  `json:"royaltyNgn"`
	DueBy      string `json:"dueBy"`
}

// QuoteRoyalty works out a past month's royalty. Settled, current or empty months cannot be paid.
func (st Store) QuoteRoyalty(ctx context.Context, l Licensee, month string) (RoyaltyQuote, error) {
	m, err := time.Parse("2006-01", month)
	if err != nil || !m.Before(monthStart(time.Now())) {
		return RoyaltyQuote{}, fmt.Errorf("%w: pick a past month", ErrBadInput)
	}
	var sales int64
	var settled bool
	if err := st.DB.QueryRow(ctx, `SELECT coalesce((SELECT sum(amount_ngn) FROM licence_sales WHERE licence = $1 AND NOT returned AND sold_at >= $2 AND sold_at < $2::date + interval '1 month'), 0),
	    EXISTS (SELECT 1 FROM licence_settlements WHERE licence = $1 AND month = $2)`, l.Licence, m).Scan(&sales, &settled); err != nil {
		return RoyaltyQuote{}, err
	}
	if settled {
		return RoyaltyQuote{}, fmt.Errorf("%w: this month is already settled", ErrBadInput)
	}
	q := RoyaltyQuote{Month: month, Invoice: InvoiceNo(l.Licence, m), SalesNGN: sales, RoyaltyNGN: sales * int64(l.Plan.RoyaltyPct) / 100,
		DueBy: RoyaltyDueBy(m).Format("2006-01-02")}
	if q.RoyaltyNGN <= 0 {
		return RoyaltyQuote{}, fmt.Errorf("%w: nothing is owed for this month", ErrBadInput)
	}
	return q, nil
}

// StartRoyaltyPayment records the PayPal order that pays a month's royalty.
func (st Store) StartRoyaltyPayment(ctx context.Context, l Licensee, accountID, month, orderID string) error {
	q, err := st.QuoteRoyalty(ctx, l, month)
	if err != nil {
		return err
	}
	_, err = st.DB.Exec(ctx, `INSERT INTO licence_royalty_payments (order_id, licence, month, amount_ngn, account_id) VALUES ($1, $2, $3, $4, $5)`,
		orderID, l.Licence, q.Month+"-01", q.RoyaltyNGN, accountID)
	return err
}

// RoyaltyPaid is a captured royalty order.
type RoyaltyPaid struct {
	Licence string
	Month   time.Time
	Account string
}

// MarkRoyaltyPaid settles the month once PayPal captures the order. It returns nil when the
// order is not a royalty payment; a repeat capture changes nothing.
func (st Store) MarkRoyaltyPaid(ctx context.Context, orderID string) (*RoyaltyPaid, error) {
	var out *RoyaltyPaid
	err := pgx.BeginFunc(ctx, st.DB, func(tx pgx.Tx) error {
		var r RoyaltyPaid
		var account *string
		err := tx.QueryRow(ctx, `UPDATE licence_royalty_payments SET paid_at = coalesce(paid_at, now()) WHERE order_id = $1 RETURNING licence, month, account_id`, orderID).
			Scan(&r.Licence, &r.Month, &account)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		if account != nil {
			r.Account = *account
		}
		if _, err := tx.Exec(ctx, `INSERT INTO licence_settlements (licence, month, on_time) VALUES ($1, $2, now() < $2::date + interval '1 month 5 days') ON CONFLICT DO NOTHING`,
			r.Licence, r.Month); err != nil {
			return err
		}
		out = &r
		return nil
	})
	return out, err
}

// QueueStatements queues last month's royalty statement (email 41) for every active partner that
// owes one, from 08:00 UTC on the 1st (and on the 2nd and 3rd, in case the service was down).
func (st Store) QueueStatements(ctx context.Context, now time.Time) (int, error) {
	now = now.UTC()
	if now.Day() > 3 || (now.Day() == 1 && now.Hour() < 8) {
		return 0, nil
	}
	month := monthStart(now).AddDate(0, -1, 0)
	rows, err := st.DB.Query(ctx, `SELECT b.licence, b.name, b.plan, a.email, coalesce(sum(s.amount_ngn), 0)
	  FROM brand_licensees b JOIN accounts a ON a.id = b.account_id
	  JOIN licence_sales s ON s.licence = b.licence AND NOT s.returned AND s.sold_at >= $1 AND s.sold_at < $1::date + interval '1 month'
	  WHERE b.status = 'active' AND NOT EXISTS (SELECT 1 FROM licence_settlements x WHERE x.licence = b.licence AND x.month = $1)
	  GROUP BY b.licence, b.name, b.plan, a.email`, month)
	if err != nil {
		return 0, err
	}
	type due struct {
		licence, name, plan, email string
		sales                      int64
	}
	var list []due
	for rows.Next() {
		var d due
		if err := rows.Scan(&d.licence, &d.name, &d.plan, &d.email, &d.sales); err != nil {
			rows.Close()
			return 0, err
		}
		list = append(list, d)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	n := 0
	for _, d := range list {
		p, ok := Plans[d.plan]
		royalty := d.sales * int64(p.RoyaltyPct) / 100
		if !ok || royalty <= 0 {
			continue
		}
		tag, err := st.DB.Exec(ctx, `INSERT INTO mail_outbox (kind, to_email, to_name, data, dedupe)
		  VALUES ('royalty_statement', $1, $2, jsonb_build_object('company', $2::text, 'licence', $3::text, 'month', $4::text, 'plan', $5::text,
		    'pct', $6::int, 'salesNgn', $7::bigint, 'royaltyNgn', $8::bigint, 'dueBy', $9::text, 'invoice', $10::text), $11)
		  ON CONFLICT (dedupe) DO NOTHING`,
			d.email, d.name, d.licence, month.Format("2006-01"), p.Name, p.RoyaltyPct, d.sales, royalty,
			RoyaltyDueBy(month).Format("2006-01-02"), InvoiceNo(d.licence, month), "royalty:"+d.licence+":"+month.Format("2006-01"))
		if err != nil {
			return n, err
		}
		n += int(tag.RowsAffected())
	}
	return n, nil
}
