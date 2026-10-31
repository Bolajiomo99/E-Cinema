// Package tickets holds and sells seats without ever overselling a screening.
package tickets

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound = errors.New("showtime not found")
	ErrSoldOut  = errors.New("not enough seats left")
	ErrBadSeats = errors.New("seats must be between 1 and 10")
	ErrNoHold   = errors.New("hold not found, expired or already used")
)

const HoldFor = 10 * time.Minute

type Showtime struct {
	ID          string    `json:"id"`
	Film        string    `json:"film"`
	Studio      string    `json:"studio"`
	StartsAt    time.Time `json:"startsAt"`
	DurationMin int       `json:"durationMin"`
	Capacity    int       `json:"capacity"`
	Available   int       `json:"available"`
	PriceCents  int       `json:"priceCents"`
	Currency    string    `json:"currency"`
}

type Hold struct {
	ID         string    `json:"id"`
	ShowtimeID string    `json:"showtimeId"`
	Seats      int       `json:"seats"`
	TotalCents int       `json:"totalCents"`
	Currency   string    `json:"currency"`
	ExpiresAt  time.Time `json:"expiresAt"`
}

type Store struct{ DB *pgxpool.Pool }

// Seats still counted against capacity: paid ones and holds that have not expired.
const taken = `COALESCE((SELECT sum(seats) FROM holds h WHERE h.showtime_id = s.id
  AND (h.status = 'paid' OR (h.status = 'held' AND h.expires_at > now()))), 0)`

func (st Store) List(ctx context.Context) ([]Showtime, error) {
	rows, err := st.DB.Query(ctx, `SELECT id, film, studio, starts_at, duration_min, capacity,
	  capacity - `+taken+`, price_cents, currency FROM showtimes s WHERE starts_at > now() - interval '1 day' ORDER BY starts_at`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Showtime, error) {
		var s Showtime
		err := r.Scan(&s.ID, &s.Film, &s.Studio, &s.StartsAt, &s.DurationMin, &s.Capacity, &s.Available, &s.PriceCents, &s.Currency)
		return s, err
	})
}

func (st Store) Get(ctx context.Context, id string) (Showtime, error) {
	var s Showtime
	err := st.DB.QueryRow(ctx, `SELECT id, film, studio, starts_at, duration_min, capacity,
	  capacity - `+taken+`, price_cents, currency FROM showtimes s WHERE id = $1`, id).
		Scan(&s.ID, &s.Film, &s.Studio, &s.StartsAt, &s.DurationMin, &s.Capacity, &s.Available, &s.PriceCents, &s.Currency)
	if errors.Is(err, pgx.ErrNoRows) {
		return s, ErrNotFound
	}
	return s, err
}

// Hold reserves seats for HoldFor. The showtime row is locked, so concurrent buyers queue
// on it and the availability check plus insert happen as one step.
// accountID links the seats to a signed-in viewer; it is empty for guest holds.
func (st Store) Hold(ctx context.Context, showtimeID, viewerRef string, seats int, accountID string) (Hold, error) {
	if seats < 1 || seats > 10 {
		return Hold{}, ErrBadSeats
	}
	var h Hold
	err := pgx.BeginFunc(ctx, st.DB, func(tx pgx.Tx) error {
		var capacity, price int
		var currency string
		err := tx.QueryRow(ctx, `SELECT capacity, price_cents, currency FROM showtimes WHERE id = $1 FOR UPDATE`, showtimeID).Scan(&capacity, &price, &currency)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		var used int
		if err := tx.QueryRow(ctx, `SELECT `+taken+` FROM showtimes s WHERE s.id = $1`, showtimeID).Scan(&used); err != nil {
			return err
		}
		if used+seats > capacity {
			return ErrSoldOut
		}
		h = Hold{ShowtimeID: showtimeID, Seats: seats, TotalCents: price * seats, Currency: currency}
		return tx.QueryRow(ctx, `INSERT INTO holds (showtime_id, seats, viewer_ref, expires_at, account_id)
		  VALUES ($1, $2, $3, now() + $4::interval, NULLIF($5, '')::uuid) RETURNING id, expires_at`,
			showtimeID, seats, viewerRef, HoldFor.String(), accountID).Scan(&h.ID, &h.ExpiresAt)
	})
	return h, err
}

// AttachOrder links a PayPal order to an active hold, so the webhook can find it later.
func (st Store) AttachOrder(ctx context.Context, holdID, orderID string) error {
	tag, err := st.DB.Exec(ctx, `UPDATE holds SET paypal_order_id = $2
	  WHERE id = $1 AND status = 'held' AND expires_at > now() AND paypal_order_id IS NULL`, holdID, orderID)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNoHold
	}
	return err
}

// MarkPaid turns a hold into sold seats when PayPal confirms the capture.
// It is idempotent: a repeated webhook for the same capture changes nothing.
// A capture that arrives just after the hold expired still counts, because the money was taken.
func (st Store) MarkPaid(ctx context.Context, orderID, captureID string) error {
	tag, err := st.DB.Exec(ctx, `UPDATE holds SET status = 'paid', paypal_capture_id = $2
	  WHERE paypal_order_id = $1 AND (status = 'held' OR (status = 'paid' AND paypal_capture_id = $2))`, orderID, captureID)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNoHold
	}
	return err
}

// HasTicket reports whether the account has paid for at least one seat at the screening.
func (st Store) HasTicket(ctx context.Context, showtimeID, accountID string) (bool, error) {
	var ok bool
	err := st.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM holds
	  WHERE showtime_id = $1 AND account_id = $2 AND status = 'paid')`, showtimeID, accountID).Scan(&ok)
	return ok, err
}

// Release frees a hold early, for example when the viewer cancels in PayPal.
func (st Store) Release(ctx context.Context, holdID string) error {
	_, err := st.DB.Exec(ctx, `UPDATE holds SET status = 'released' WHERE id = $1 AND status = 'held'`, holdID)
	return err
}
