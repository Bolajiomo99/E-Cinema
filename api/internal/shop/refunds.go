package shop

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Refund requests (Figma 96:1426). A member says what went wrong with an order and picks a
// refund or a replacement. Clear cases are approved at once under the refund rules; the rest
// wait for the delivery team.
const (
	InstantLimitNGN = 20000         // wrong or damaged items up to this total are refunded without review
	NeverArrivedGap = 2 * time.Hour // an order out with a rider this long counts as never arrived
)

var ErrAlreadyAsked = errors.New("you have already asked about this order")

var refundReasons = map[string]string{"late": "Arrived late", "wrong": "Wrong item", "damaged": "Damaged", "never": "Never arrived"}

type Refund struct {
	ID        string    `json:"id"`
	OrderID   string    `json:"orderId"`
	Number    string    `json:"number,omitempty"`
	Reason    string    `json:"reason"`
	Note      string    `json:"note"`
	Outcome   string    `json:"outcome"`
	Status    string    `json:"status"`
	AmountNGN int       `json:"amountNgn"`
	CreatedAt time.Time `json:"createdAt"`
	Buyer     string    `json:"buyer,omitempty"`
}

// Verdict says, before anything is saved, whether this reason qualifies for an instant answer.
type Verdict struct {
	Instant bool   `json:"instant"`
	Why     string `json:"why"`
}

// Late is true when a before-the-show item reached the buyer after its film started.
func Late(o Order) bool {
	if o.DeliveredAt == nil {
		return false
	}
	for _, it := range o.Items {
		if it.BeforeShow && it.StartsAt != nil && o.DeliveredAt.After(*it.StartsAt) {
			return true
		}
	}
	return false
}

// Judge applies the refund rules to one order and reason.
func Judge(o Order, reason string, now time.Time) (Verdict, error) {
	if _, ok := refundReasons[reason]; !ok {
		return Verdict{}, fmt.Errorf("%w: pick what went wrong", ErrBadInput)
	}
	switch o.Status {
	case "delivered":
		if reason == "never" {
			return Verdict{false, "This order shows as delivered, so the delivery team will check with the rider first."}, nil
		}
		if o.DeliveredAt != nil && now.Sub(*o.DeliveredAt) > ReturnDays*24*time.Hour {
			return Verdict{}, ErrTooLate
		}
	case "out":
		if reason != "never" {
			return Verdict{}, fmt.Errorf("%w: this order has not been delivered yet", ErrBadInput)
		}
		if o.OutAt == nil || now.Sub(*o.OutAt) < NeverArrivedGap {
			return Verdict{}, fmt.Errorf("%w: the rider is still on the way; you can ask once it has been out for 2 hours", ErrBadInput)
		}
		return Verdict{true, "It has been out with the rider for over 2 hours."}, nil
	default:
		return Verdict{}, ErrTooLate
	}
	switch {
	case reason == "late" && Late(o):
		return Verdict{true, "It was delivered after the premiere started."}, nil
	case reason == "late":
		return Verdict{false, "Our records show it arrived before the film started, so the team will take a look."}, nil
	case o.TotalNGN <= InstantLimitNGN:
		return Verdict{true, "Wrong or damaged orders under ₦20,000 are refunded straight away."}, nil
	}
	return Verdict{false, "Larger orders are checked by the delivery team, usually within a day."}, nil
}

// AskRefund records the request. An instant one is approved; the caller then pays it back.
// creditCents is what the order is worth in wallet credit at today's rate, used for pay on delivery.
func (st Store) AskRefund(ctx context.Context, accountID, orderID, reason, note, outcome string, creditCents int, now time.Time) (Refund, Order, error) {
	note = strings.TrimSpace(note)
	if len(note) > 500 {
		return Refund{}, Order{}, fmt.Errorf("%w: keep the note under 500 characters", ErrBadInput)
	}
	if outcome != "refund" && outcome != "replace" {
		return Refund{}, Order{}, fmt.Errorf("%w: choose a refund or a replacement", ErrBadInput)
	}
	o, err := st.Mine(ctx, accountID, orderID)
	if err != nil {
		return Refund{}, o, err
	}
	v, err := Judge(o, reason, now)
	if err != nil {
		return Refund{}, o, err
	}
	status := "review"
	if v.Instant {
		status = "approved"
	}
	amount := o.TotalNGN
	if outcome == "replace" {
		amount = 0
	}
	credit := 0
	if outcome == "refund" && o.Method == "cod" {
		if creditCents <= 0 {
			return Refund{}, o, fmt.Errorf("%w: wallet refunds are briefly unavailable", ErrBadInput)
		}
		credit = creditCents
	}
	var rf Refund
	err = pgx.BeginFunc(ctx, st.DB, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `INSERT INTO shop_refunds (order_id, account_id, reason, note, outcome, status, amount_ngn, credit_cents, decided_at)
		  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $6 = 'approved' THEN now() END)
		  ON CONFLICT (order_id) DO NOTHING
		  RETURNING id, order_id, reason, note, outcome, status, amount_ngn, created_at`,
			o.ID, accountID, reason, note, outcome, status, amount, credit).
			Scan(&rf.ID, &rf.OrderID, &rf.Reason, &rf.Note, &rf.Outcome, &rf.Status, &rf.AmountNGN, &rf.CreatedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrAlreadyAsked
		}
		if err == nil && status == "approved" {
			err = creditWallet(ctx, tx, rf.ID)
		}
		return err
	})
	rf.Number = o.Number
	return rf, o, err
}

// creditWallet pays an approved pay-on-delivery refund into the buyer's wallet.
func creditWallet(ctx context.Context, tx pgx.Tx, id string) error {
	_, err := tx.Exec(ctx, `INSERT INTO credits (account_id, delta_cents, currency, reason, ref)
	  SELECT account_id, credit_cents, 'USD', 'Store refund', 'shop-refund:' || id FROM shop_refunds
	  WHERE id = $1 AND status = 'approved' AND credit_cents > 0 AND account_id IS NOT NULL`, id)
	return err
}

// RefundFor returns the member's request on an order, if any.
func (st Store) RefundFor(ctx context.Context, accountID, orderID string) (*Refund, error) {
	var rf Refund
	err := st.DB.QueryRow(ctx, `SELECT f.id, f.order_id, o.number, f.reason, f.note, f.outcome, f.status, f.amount_ngn, f.created_at
	  FROM shop_refunds f JOIN shop_orders o ON o.id = f.order_id WHERE f.order_id = $1 AND o.account_id = $2`, orderID, accountID).
		Scan(&rf.ID, &rf.OrderID, &rf.Number, &rf.Reason, &rf.Note, &rf.Outcome, &rf.Status, &rf.AmountNGN, &rf.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &rf, err
}

// PendingRefunds is the delivery team's queue.
func (st Store) PendingRefunds(ctx context.Context) ([]Refund, error) {
	rows, err := st.DB.Query(ctx, `SELECT f.id, f.order_id, o.number, f.reason, f.note, f.outcome, f.status, f.amount_ngn, f.created_at, coalesce(a.email, '')
	  FROM shop_refunds f JOIN shop_orders o ON o.id = f.order_id LEFT JOIN accounts a ON a.id = f.account_id
	  WHERE f.status = 'review' ORDER BY f.created_at`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Refund, error) {
		var rf Refund
		err := r.Scan(&rf.ID, &rf.OrderID, &rf.Number, &rf.Reason, &rf.Note, &rf.Outcome, &rf.Status, &rf.AmountNGN, &rf.CreatedAt, &rf.Buyer)
		return rf, err
	})
}

// DecideRefund is staff approving or declining a request under review.
func (st Store) DecideRefund(ctx context.Context, id string, approve bool) (Refund, Order, error) {
	status := "declined"
	if approve {
		status = "approved"
	}
	var orderID string
	err := pgx.BeginFunc(ctx, st.DB, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `UPDATE shop_refunds SET status = $2, decided_at = now() WHERE id = $1 AND status = 'review' RETURNING order_id`, id, status).Scan(&orderID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err == nil && approve {
			err = creditWallet(ctx, tx, id)
		}
		return err
	})
	if err != nil {
		return Refund{}, Order{}, err
	}
	o, err := st.order(ctx, `o.id = $1`, orderID)
	if err != nil {
		return Refund{}, o, err
	}
	rf, err := st.RefundFor(ctx, o.AccountID, orderID)
	if err != nil || rf == nil {
		return Refund{}, o, err
	}
	return *rf, o, nil
}

// MarkRefundPaid keeps the PayPal refund id so a repeat call does not pay twice.
func (st Store) MarkRefundPaid(ctx context.Context, id, paypalRefundID string) error {
	_, err := st.DB.Exec(ctx, `UPDATE shop_refunds SET paypal_refund_id = $2 WHERE id = $1 AND paypal_refund_id IS NULL`, id, paypalRefundID)
	return err
}

// ToSend lists approved replacements the delivery team still has to send.
func (st Store) ToSend(ctx context.Context) ([]Refund, error) {
	rows, err := st.DB.Query(ctx, `SELECT f.id, f.order_id, o.number, f.reason, f.note, f.outcome, f.status, f.amount_ngn, f.created_at, coalesce(a.email, '')
	  FROM shop_refunds f JOIN shop_orders o ON o.id = f.order_id LEFT JOIN accounts a ON a.id = f.account_id
	  WHERE f.status = 'approved' AND f.outcome = 'replace' AND f.sent_at IS NULL ORDER BY f.decided_at`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Refund, error) {
		var rf Refund
		err := r.Scan(&rf.ID, &rf.OrderID, &rf.Number, &rf.Reason, &rf.Note, &rf.Outcome, &rf.Status, &rf.AmountNGN, &rf.CreatedAt, &rf.Buyer)
		return rf, err
	})
}

// MarkSent records that a replacement left with a rider.
func (st Store) MarkSent(ctx context.Context, id string) error {
	tag, err := st.DB.Exec(ctx, `UPDATE shop_refunds SET sent_at = now() WHERE id = $1 AND status = 'approved' AND outcome = 'replace' AND sent_at IS NULL`, id)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}
