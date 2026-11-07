package shop

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Pay in 6 (Figma Shop hero "or 6 × …", Cart "Pay in 6 instalments"). The first part is paid on
// Paystack's page, which saves the card; the web worker charges each later part to that card a
// month apart and reports back here. A plan stops when its order is cancelled or returned.
const (
	InstalmentParts  = 6
	InstalmentMinNGN = 100_000
	instalmentGap    = 30 * 24 * time.Hour
	maxPartAttempts  = 3
)

// FirstPart is what each part costs; the last part takes whatever is left.
func FirstPart(total int) int { return (total + InstalmentParts - 1) / InstalmentParts }

// PartAmount is the amount of part n (1-based) of a plan.
func PartAmount(total, parts, part, n int) int {
	if n >= parts {
		return total - part*(parts-1)
	}
	return part
}

// Plan is an order's instalment plan as the buyer sees it.
type Plan struct {
	Parts     int        `json:"parts"`
	Paid      int        `json:"paid"`
	PartNGN   int        `json:"partNgn"`
	NextNGN   int        `json:"nextNgn"`
	PaidNGN   int        `json:"paidNgn"`
	Status    string     `json:"status"`
	NextDue   *time.Time `json:"nextDue,omitempty"`
	LastError string     `json:"lastError,omitempty"`
}

func (st Store) plans(ctx context.Context, orders []Order, ids []string, at map[string]int) error {
	rows, err := st.DB.Query(ctx, `SELECT order_id, parts, paid_parts, part_ngn, total_ngn, status, next_due, last_error FROM shop_instalments WHERE order_id = ANY($1)`, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var oid string
		var p Plan
		var total int
		if err := rows.Scan(&oid, &p.Parts, &p.Paid, &p.PartNGN, &total, &p.Status, &p.NextDue, &p.LastError); err != nil {
			return err
		}
		for n := 1; n <= p.Paid; n++ {
			p.PaidNGN += PartAmount(total, p.Parts, p.PartNGN, n)
		}
		if p.Paid < p.Parts {
			p.NextNGN = PartAmount(total, p.Parts, p.PartNGN, p.Paid+1)
		}
		if p.Status != "active" {
			p.NextDue = nil
		}
		orders[at[oid]].Plan = &p
	}
	return rows.Err()
}

// StartPlan records the saved card once the first part is paid. Safe to repeat.
func (st Store) StartPlan(ctx context.Context, reference, authCode, email string) error {
	authCode, email = strings.TrimSpace(authCode), strings.TrimSpace(email)
	if !strings.HasPrefix(authCode, "AUTH_") || !strings.Contains(email, "@") {
		return fmt.Errorf("%w: the card was not saved", ErrBadInput)
	}
	tag, err := st.DB.Exec(ctx, `UPDATE shop_instalments i SET auth_code = $2, email = $3, paid_parts = 1, status = 'active',
	    next_due = now() + make_interval(secs => $4), last_ref = $1, updated_at = now()
	  FROM shop_orders o WHERE o.id = i.order_id AND o.paypal_order_id = $1 AND o.status <> 'pending' AND i.status = 'waiting'`,
		reference, authCode, email, instalmentGap.Seconds())
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		var n int
		if err := st.DB.QueryRow(ctx, `SELECT count(*) FROM shop_instalments i JOIN shop_orders o ON o.id = i.order_id WHERE o.paypal_order_id = $1`, reference).Scan(&n); err != nil {
			return err
		}
		if n == 0 {
			return ErrNotFound
		}
	}
	return nil
}

// DuePart is one part the web worker should charge now.
type DuePart struct {
	OrderID   string `json:"orderId"`
	Number    string `json:"number"`
	Part      int    `json:"part"`
	Parts     int    `json:"parts"`
	AmountNGN int    `json:"amountNgn"`
	AuthCode  string `json:"authCode"`
	Email     string `json:"email"`
	Reference string `json:"reference"`
}

// DueParts lists parts to charge now, for orders still going ahead.
func (st Store) DueParts(ctx context.Context, limit int) ([]DuePart, error) {
	// Plans of cancelled or returned orders stop for good.
	if _, err := st.DB.Exec(ctx, `UPDATE shop_instalments i SET status = 'stopped', next_due = NULL, updated_at = now()
	  FROM shop_orders o WHERE o.id = i.order_id AND i.status IN ('waiting', 'active') AND o.status IN ('cancelled', 'returning', 'returned')`); err != nil {
		return nil, err
	}
	rows, err := st.DB.Query(ctx, `SELECT i.order_id, o.number, i.paid_parts + 1, i.parts, i.part_ngn, i.total_ngn, i.auth_code, i.email, i.attempts
	  FROM shop_instalments i JOIN shop_orders o ON o.id = i.order_id
	  WHERE i.status = 'active' AND i.next_due <= now() ORDER BY i.next_due LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DuePart{}
	for rows.Next() {
		var d DuePart
		var part, total, attempts int
		if err := rows.Scan(&d.OrderID, &d.Number, &d.Part, &d.Parts, &part, &total, &d.AuthCode, &d.Email, &attempts); err != nil {
			return nil, err
		}
		d.AmountNGN = PartAmount(total, d.Parts, part, d.Part)
		// One reference per part and try, so Paystack never charges a part twice for one try.
		d.Reference = fmt.Sprintf("PSK-%s-%d-%d", strings.ReplaceAll(d.OrderID, "-", "")[:12], d.Part, attempts)
		out = append(out, d)
	}
	return out, rows.Err()
}

// PartResult records a charge attempt. A failed part is tried again the next day, three times.
func (st Store) PartResult(ctx context.Context, orderID string, part int, ok bool, reference, why string) (*Order, error) {
	var err error
	if ok {
		_, err = st.DB.Exec(ctx, `UPDATE shop_instalments SET paid_parts = $2, attempts = 0, last_ref = $3, last_error = '',
		    status = CASE WHEN $2 >= parts THEN 'done' ELSE 'active' END,
		    next_due = CASE WHEN $2 >= parts THEN NULL ELSE next_due + make_interval(secs => $4) END, updated_at = now()
		  WHERE order_id = $1 AND status = 'active' AND paid_parts = $2 - 1`, orderID, part, reference, instalmentGap.Seconds())
	} else {
		if len(why) > 200 {
			why = why[:200]
		}
		_, err = st.DB.Exec(ctx, `UPDATE shop_instalments SET attempts = attempts + 1, last_ref = $3, last_error = $4,
		    status = CASE WHEN attempts + 1 >= $5 THEN 'failed' ELSE 'active' END,
		    next_due = CASE WHEN attempts + 1 >= $5 THEN NULL ELSE now() + interval '1 day' END, updated_at = now()
		  WHERE order_id = $1 AND status = 'active' AND paid_parts = $2 - 1`, orderID, part, reference, why, maxPartAttempts)
	}
	if err != nil {
		return nil, err
	}
	o, err := st.order(ctx, `o.id = $1`, orderID)
	if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, ErrNotFound) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}
