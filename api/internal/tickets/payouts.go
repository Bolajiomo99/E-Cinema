package tickets

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

var (
	ErrNotEnded   = errors.New("screening has not ended yet")
	ErrNoStudio   = errors.New("studio has no payout account")
	ErrBadOutcome = errors.New("status must be sent or failed")
	ErrNoPayout   = errors.New("no open payout for this screening")
)

// Statement is what a studio is owed for one screening.
type Statement struct {
	ShowtimeID    string `json:"showtimeId"`
	Film          string `json:"film"`
	Studio        string `json:"studio"`
	PayoutEmail   string `json:"payoutEmail"`
	Ended         bool   `json:"ended"`
	PaidSeats     int    `json:"paidSeats"`
	GrossCents    int64  `json:"grossCents"`
	StudioCents   int64  `json:"studioCents"`
	Currency      string `json:"currency"`
	SenderBatchID string `json:"senderBatchId"`
	Status        string `json:"status"` // unpaid, pending, sent, failed, nothing_due
	PaypalBatchID string `json:"paypalBatchId,omitempty"`
}

const statementSQL = `
SELECT s.id, s.film, s.studio, COALESCE(st.payout_email, ''), COALESCE(st.share_bps, 0),
       s.starts_at + make_interval(mins => s.duration_min) < $2,
       COALESCE((SELECT sum(h.seats) FROM holds h WHERE h.showtime_id = s.id AND h.status = 'paid'), 0),
       COALESCE((SELECT sum(COALESCE(h.net_cents, h.seats * s.price_cents)) FROM holds h WHERE h.showtime_id = s.id AND h.status = 'paid'), 0),
       s.currency,
       COALESCE(p.status, 'unpaid'), COALESCE(p.paypal_batch_id, ''),
       p.paid_seats, p.gross_cents, p.studio_cents
FROM showtimes s
LEFT JOIN studios st ON st.name = s.studio
LEFT JOIN studio_payouts p ON p.showtime_id = s.id
WHERE s.id = $1`

func scanStatement(row pgx.Row) (Statement, error) {
	var (
		s                   Statement
		shareBps            int
		gross               int64
		lockedSeats         *int
		lockedGross, locked *int64
	)
	err := row.Scan(&s.ShowtimeID, &s.Film, &s.Studio, &s.PayoutEmail, &shareBps, &s.Ended,
		&s.PaidSeats, &gross, &s.Currency, &s.Status, &s.PaypalBatchID, &lockedSeats, &lockedGross, &locked)
	if errors.Is(err, pgx.ErrNoRows) {
		return s, ErrNotFound
	}
	if err != nil {
		return s, err
	}
	s.GrossCents = gross
	s.StudioCents = s.GrossCents * int64(shareBps) / 10000
	if lockedSeats != nil { // once claimed, the amounts are frozen
		s.PaidSeats, s.GrossCents, s.StudioCents = *lockedSeats, *lockedGross, *locked
	}
	s.SenderBatchID = "ecinema-" + s.ShowtimeID
	return s, nil
}

// Statement reports what the studio is owed for a screening, without changing anything.
func (st Store) Statement(ctx context.Context, showtimeID string) (Statement, error) {
	return scanStatement(st.DB.QueryRow(ctx, statementSQL, showtimeID, time.Now()))
}

// ClaimPayout freezes the amounts for an ended screening and marks the payout pending.
// Calling it again returns the same frozen statement, so the caller can safely retry.
func (st Store) ClaimPayout(ctx context.Context, showtimeID string) (Statement, error) {
	tx, err := st.DB.Begin(ctx)
	if err != nil {
		return Statement{}, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT 1 FROM showtimes WHERE id = $1 FOR UPDATE`, showtimeID); err != nil {
		return Statement{}, err
	}
	s, err := scanStatement(tx.QueryRow(ctx, statementSQL, showtimeID, time.Now()))
	if err != nil {
		return s, err
	}
	if s.Status != "unpaid" {
		return s, tx.Commit(ctx)
	}
	if !s.Ended {
		return s, ErrNotEnded
	}
	if s.PayoutEmail == "" {
		return s, ErrNoStudio
	}
	s.Status = "pending"
	if s.StudioCents == 0 {
		s.Status = "nothing_due"
	}
	_, err = tx.Exec(ctx, `INSERT INTO studio_payouts (showtime_id, studio, paid_seats, gross_cents, studio_cents, currency, status)
	  VALUES ($1, $2, $3, $4, $5, $6, $7)`, s.ShowtimeID, s.Studio, s.PaidSeats, s.GrossCents, s.StudioCents, s.Currency, s.Status)
	if err != nil {
		return s, err
	}
	return s, tx.Commit(ctx)
}

// RecordPayout stores PayPal's answer. A sent payout is never changed back.
func (st Store) RecordPayout(ctx context.Context, showtimeID, status, batchID string) error {
	if status != "sent" && status != "failed" {
		return ErrBadOutcome
	}
	tag, err := st.DB.Exec(ctx, `UPDATE studio_payouts SET status = $2, paypal_batch_id = NULLIF($3, ''), updated_at = now()
	  WHERE showtime_id = $1 AND status IN ('pending', 'failed')`, showtimeID, status, batchID)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNoPayout
	}
	return err
}

// DuePayouts lists ended screenings whose studio has not been paid yet (never claimed, pending or failed).
func (st Store) DuePayouts(ctx context.Context) ([]string, error) {
	rows, err := st.DB.Query(ctx, `SELECT s.id FROM showtimes s
	  LEFT JOIN studio_payouts p ON p.showtime_id = s.id
	  WHERE s.starts_at + make_interval(mins => s.duration_min) < now()
	    AND (p.status IS NULL OR p.status IN ('pending', 'failed'))
	  ORDER BY s.starts_at LIMIT 500`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}
