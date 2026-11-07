package tickets

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var (
	ErrNotEnded   = errors.New("screening has not ended yet")
	ErrNoStudio   = errors.New("studio has no payout account")
	ErrBadOutcome = errors.New("status must be sent, submitted or failed")
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
	// Bank transfer payouts (Flutterwave). Method is "paypal" or "bank"; Reference is the transfer
	// reference for this attempt, and TransferID is set while a transfer is in flight.
	Method         string `json:"method"`
	BankCode       string `json:"bankCode,omitempty"`
	AccountNumber  string `json:"accountNumber,omitempty"`
	AccountName    string `json:"accountName,omitempty"`
	PayoutCurrency string `json:"payoutCurrency,omitempty"`
	Reference      string `json:"reference"`
	TransferID     string `json:"transferId,omitempty"`
}

const statementSQL = `
SELECT s.id, s.film, s.studio, COALESCE(st.payout_email, ''), COALESCE(st.share_bps, 0),
       COALESCE(p.method, st.payout_method, 'paypal'), COALESCE(st.payout_bank_code, ''), COALESCE(st.payout_number, ''), COALESCE(st.payout_name, ''), COALESCE(st.payout_currency, ''),
       COALESCE(p.transfer_id, ''), COALESCE(p.attempts, 0),
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
		attempts            int
	)
	err := row.Scan(&s.ShowtimeID, &s.Film, &s.Studio, &s.PayoutEmail, &shareBps,
		&s.Method, &s.BankCode, &s.AccountNumber, &s.AccountName, &s.PayoutCurrency, &s.TransferID, &attempts, &s.Ended,
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
	s.Reference = s.SenderBatchID
	if attempts > 0 {
		s.Reference = fmt.Sprintf("%s-%d", s.SenderBatchID, attempts)
	}
	if s.Method != "bank" {
		s.BankCode, s.AccountNumber, s.AccountName, s.PayoutCurrency = "", "", "", ""
	}
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
	if (s.Method == "bank" && (s.BankCode == "" || s.AccountNumber == "")) || (s.Method != "bank" && s.PayoutEmail == "") {
		return s, ErrNoStudio
	}
	s.Status = "pending"
	if s.StudioCents == 0 {
		s.Status = "nothing_due"
	}
	_, err = tx.Exec(ctx, `INSERT INTO studio_payouts (showtime_id, studio, paid_seats, gross_cents, studio_cents, currency, status, method)
	  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, s.ShowtimeID, s.Studio, s.PaidSeats, s.GrossCents, s.StudioCents, s.Currency, s.Status, s.Method)
	if err != nil {
		return s, err
	}
	return s, tx.Commit(ctx)
}

// Outcome is what the payout service reports for a screening's payout.
type Outcome struct {
	Status       string `json:"status"` // sent, failed, or submitted (a bank transfer in flight)
	BatchID      string `json:"batchId"`
	TransferID   string `json:"transferId"`
	PaidCurrency string `json:"paidCurrency"`
	PaidMinor    int64  `json:"paidMinor"`
}

// RecordPayout stores the payout service's answer. A sent payout is never changed back. A
// submitted bank transfer stays pending with its transfer id; a failed one counts an attempt
// and clears the id, so the next sweep tries again under a fresh reference.
func (st Store) RecordPayout(ctx context.Context, showtimeID string, o Outcome) error {
	var (
		tag pgconn.CommandTag
		err error
	)
	switch {
	case o.Status == "sent":
		tag, err = st.DB.Exec(ctx, `UPDATE studio_payouts SET status = 'sent', paypal_batch_id = NULLIF($2, ''),
		  transfer_id = CASE WHEN $3 <> '' THEN $3 ELSE transfer_id END, paid_currency = $4, paid_minor = $5, updated_at = now()
		  WHERE showtime_id = $1 AND status IN ('pending', 'failed')`, showtimeID, o.BatchID, o.TransferID, o.PaidCurrency, o.PaidMinor)
	case o.Status == "submitted" && o.TransferID != "":
		tag, err = st.DB.Exec(ctx, `UPDATE studio_payouts SET status = 'pending', transfer_id = $2, paid_currency = $3, paid_minor = $4, updated_at = now()
		  WHERE showtime_id = $1 AND status IN ('pending', 'failed')`, showtimeID, o.TransferID, o.PaidCurrency, o.PaidMinor)
	case o.Status == "failed":
		tag, err = st.DB.Exec(ctx, `UPDATE studio_payouts SET status = 'failed', attempts = attempts + CASE WHEN method = 'bank' THEN 1 ELSE 0 END,
		  transfer_id = '', updated_at = now() WHERE showtime_id = $1 AND status IN ('pending', 'failed')`, showtimeID)
	default:
		return ErrBadOutcome
	}
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
