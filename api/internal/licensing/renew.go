package licensing

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// Renewal is a paid year added to a licence, optionally moving to a bigger plan.
type Renewal struct {
	Licence    string    `json:"licence"`
	Plan       string    `json:"plan"`
	FeeNGN     int       `json:"feeNgn"`
	ValidUntil time.Time `json:"validUntil"`
	Account    string    `json:"-"`
}

// RenewalQuote is what a year on the chosen plan costs. Global is agreed with sales, and a
// licence cannot move down to a smaller plan here.
func RenewalQuote(l Licensee, plan string) (Plan, error) {
	p, ok := Plans[plan]
	if !ok || p.FeeNGN <= 0 {
		return Plan{}, fmt.Errorf("%w: talk to us about the Global plan", ErrBadInput)
	}
	if l.Role != "owner" {
		return Plan{}, ErrForbidden
	}
	if l.Plan.ID == "global" || (l.Plan.ID == "growth" && plan == "starter") {
		return Plan{}, fmt.Errorf("%w: plans can only move up", ErrBadInput)
	}
	return p, nil
}

// StartRenewal records the PayPal order for a renewal so the capture can find it.
func (st Store) StartRenewal(ctx context.Context, l Licensee, accountID, plan, orderID string) error {
	p, err := RenewalQuote(l, plan)
	if err != nil {
		return err
	}
	_, err = st.DB.Exec(ctx, `INSERT INTO licence_renewals (order_id, licence, plan, fee_ngn, account_id) VALUES ($1, $2, $3, $4, $5)`, orderID, l.Licence, p.ID, p.FeeNGN, accountID)
	return err
}

// MarkRenewed adds a year from today or from the current end date, whichever is later, and
// moves the licence to the paid plan. A repeat capture changes nothing. It returns nil when
// the order is not a renewal.
func (st Store) MarkRenewed(ctx context.Context, orderID string) (*Renewal, error) {
	var out *Renewal
	err := pgx.BeginFunc(ctx, st.DB, func(tx pgx.Tx) error {
		var r Renewal
		var paid *time.Time
		var account *string
		err := tx.QueryRow(ctx, `SELECT licence, plan, fee_ngn, paid_at, account_id FROM licence_renewals WHERE order_id = $1 FOR UPDATE`, orderID).Scan(&r.Licence, &r.Plan, &r.FeeNGN, &paid, &account)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		if account != nil {
			r.Account = *account
		}
		if paid == nil {
			if _, err := tx.Exec(ctx, `UPDATE licence_renewals SET paid_at = now() WHERE order_id = $1`, orderID); err != nil {
				return err
			}
			if err := tx.QueryRow(ctx, `UPDATE brand_licensees SET plan = $2, status = CASE WHEN status = 'ended' THEN 'active' ELSE status END, valid_until = greatest(valid_until, current_date) + 365
			  WHERE licence = $1 RETURNING valid_until`, r.Licence, r.Plan).Scan(&r.ValidUntil); err != nil {
				return err
			}
		} else if err := tx.QueryRow(ctx, `SELECT valid_until FROM brand_licensees WHERE licence = $1`, r.Licence).Scan(&r.ValidUntil); err != nil {
			return err
		}
		out = &r
		return nil
	})
	return out, err
}
