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
	ErrEnded    = errors.New("this screening has ended")
	ErrBadSeats = errors.New("seats must be between 1 and 10")
	ErrNoHold   = errors.New("hold not found, expired or already used")
	ErrAdult    = errors.New("this screening is for verified adults: pass the face and ID check first")

	ErrBadQuality      = errors.New("quality must be hd, 4k or vr")
	ErrTooLateToCancel = errors.New("seats can be cancelled until 7 days before the screening")
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
func (st Store) Hold(ctx context.Context, showtimeID, viewerRef string, seats int, accountID string, quality ...string) (Hold, error) {
	if seats < 1 || seats > 10 {
		return Hold{}, ErrBadSeats
	}
	q := "hd"
	if len(quality) > 0 && quality[0] != "" {
		q = quality[0]
	}
	if q != "hd" && q != "4k" && q != "vr" {
		return Hold{}, ErrBadQuality
	}
	var h Hold
	err := pgx.BeginFunc(ctx, st.DB, func(tx pgx.Tx) error {
		var capacity, price int
		var currency string
		var adult, ended bool
		err := tx.QueryRow(ctx, `SELECT capacity, price_cents, currency, adult, starts_at + make_interval(mins => duration_min) <= now()
		  FROM showtimes WHERE id = $1 FOR UPDATE`, showtimeID).Scan(&capacity, &price, &currency, &adult, &ended)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		// Late entry is allowed until the credits roll, never after.
		if ended {
			return ErrEnded
		}
		if adult {
			var verified bool
			if accountID != "" {
				if err := tx.QueryRow(ctx, `SELECT id_verified_at IS NOT NULL AND face_verified_at IS NOT NULL FROM accounts WHERE id = $1`, accountID).Scan(&verified); err != nil && !errors.Is(err, pgx.ErrNoRows) {
					return err
				}
			}
			if !verified {
				return ErrAdult
			}
			// The seat is stage 4 of the adult unlock: the three fund stages come first.
			if n, err := paidStages(ctx, tx, accountID, showtimeID); err != nil {
				return err
			} else if n < len(Funds) {
				return ErrStagesDue
			}
		}
		var used int
		if err := tx.QueryRow(ctx, `SELECT `+taken+` FROM showtimes s WHERE s.id = $1`, showtimeID).Scan(&used); err != nil {
			return err
		}
		if used+seats > capacity {
			return ErrSoldOut
		}
		h = Hold{ShowtimeID: showtimeID, Seats: seats, TotalCents: price * seats, Currency: currency}
		return tx.QueryRow(ctx, `INSERT INTO holds (showtime_id, seats, viewer_ref, expires_at, account_id, quality)
		  VALUES ($1, $2, $3, now() + $4::interval, NULLIF($5, '')::uuid, $6) RETURNING id, expires_at`,
			showtimeID, seats, viewerRef, HoldFor.String(), accountID, q).Scan(&h.ID, &h.ExpiresAt)
	})
	return h, err
}

// AttachOrder links a PayPal order to an active hold, so the webhook can find it later.
// netCents is what the order charges for the seats before VAT; 0 means unknown.
func (st Store) AttachOrder(ctx context.Context, holdID, orderID string, netCents int) error {
	tag, err := st.DB.Exec(ctx, `UPDATE holds SET paypal_order_id = $2, net_cents = NULLIF($3, 0)
	  WHERE id = $1 AND status = 'held' AND expires_at > now() AND paypal_order_id IS NULL`, holdID, orderID, netCents)
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
		// Not a seat: it may be one of the adult unlock stages.
		if ok, err := st.markStagePaid(ctx, orderID, captureID); err != nil || ok {
			return err
		}
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

// MyTicket is a viewer's paid seats, or seats held for them while they approve the payment.
type MyTicket struct {
	HoldID     string    `json:"holdId"`
	ShowtimeID string    `json:"showtimeId"`
	Seats      int       `json:"seats"`
	Status     string    `json:"status"`  // held or paid
	Quality    string    `json:"quality"` // hd, 4k or vr
	OrderID    string    `json:"orderId,omitempty"`
	ExpiresAt  time.Time `json:"expiresAt"`
	CreatedAt  time.Time `json:"createdAt"`
}

// Mine lists an account's paid seats and its live holds, soonest screening first.
func (st Store) Mine(ctx context.Context, accountID string) ([]MyTicket, error) {
	rows, err := st.DB.Query(ctx, `SELECT h.id, h.showtime_id, h.seats, h.status, h.quality, COALESCE(h.paypal_order_id, ''), h.expires_at, h.created_at
	  FROM holds h JOIN showtimes s ON s.id = h.showtime_id
	  WHERE h.account_id = $1 AND (h.status = 'paid' OR (h.status = 'held' AND h.expires_at > now()))
	  ORDER BY s.starts_at, h.created_at`, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MyTicket{}
	for rows.Next() {
		var t MyTicket
		if err := rows.Scan(&t.HoldID, &t.ShowtimeID, &t.Seats, &t.Status, &t.Quality, &t.OrderID, &t.ExpiresAt, &t.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// ReleaseMine gives back seats an account is holding but has not paid for.
func (st Store) ReleaseMine(ctx context.Context, accountID, holdID string) error {
	tag, err := st.DB.Exec(ctx, `UPDATE holds SET status = 'released'
	  WHERE id::text = $1 AND account_id = $2 AND status = 'held'`, holdID, accountID)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNoHold
	}
	return err
}

// Upcoming is the paid audience of a screening that has not started yet, by home country.
type Upcoming struct {
	ShowtimeID string         `json:"showtimeId"`
	Seats      int            `json:"seats"`
	ByCountry  map[string]int `json:"byCountry"`
}

// Tonight counts paid seats for screenings starting within the next 24 hours, by the buyer's
// home country. Seats from accounts with no country set count in Seats only. Counts, never people.
func (st Store) Tonight(ctx context.Context) ([]Upcoming, error) {
	rows, err := st.DB.Query(ctx, `SELECT h.showtime_id, COALESCE(a.country, ''), SUM(h.seats)
	  FROM holds h
	  JOIN showtimes s ON s.id = h.showtime_id
	  LEFT JOIN accounts a ON a.id = h.account_id
	  WHERE h.status = 'paid' AND s.starts_at > now() AND s.starts_at <= now() + interval '24 hours'
	  GROUP BY 1, 2 ORDER BY 1`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Upcoming{}
	for rows.Next() {
		var id, cc string
		var n int
		if err := rows.Scan(&id, &cc, &n); err != nil {
			return nil, err
		}
		if len(out) == 0 || out[len(out)-1].ShowtimeID != id {
			out = append(out, Upcoming{ShowtimeID: id, ByCountry: map[string]int{}})
		}
		u := &out[len(out)-1]
		u.Seats += n
		if cc != "" {
			u.ByCountry[cc] += n
		}
	}
	return out, rows.Err()
}

// CancelWindow is how close to the screening a paid seat can still be cancelled for a refund.
const CancelWindow = 7 * 24 * time.Hour

// Cancellable is a paid hold the viewer may cancel, with what to refund on PayPal.
type Cancellable struct {
	HoldID    string `json:"holdId"`
	CaptureID string `json:"captureId"`
}

// CanCancel checks that the hold is the account's own paid seat and the screening is more than
// CancelWindow away. It changes nothing; the seat is released once PayPal confirms the refund.
func (st Store) CanCancel(ctx context.Context, accountID, holdID string) (Cancellable, error) {
	var c Cancellable
	var status string
	var startsAt time.Time
	err := st.DB.QueryRow(ctx, `SELECT h.id, COALESCE(h.paypal_capture_id, ''), h.status, s.starts_at
	  FROM holds h JOIN showtimes s ON s.id = h.showtime_id
	  WHERE h.id = $1 AND h.account_id = $2`, holdID, accountID).Scan(&c.HoldID, &c.CaptureID, &status, &startsAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, ErrNoHold
	}
	if err != nil {
		return c, err
	}
	if status != "paid" || c.CaptureID == "" {
		return c, ErrNoHold
	}
	if time.Until(startsAt) <= CancelWindow {
		return c, ErrTooLateToCancel
	}
	return c, nil
}

// MarkRefunded frees the seats of a refunded capture. Repeats for the same refund change nothing.
func (st Store) MarkRefunded(ctx context.Context, captureID, refundID string) error {
	tag, err := st.DB.Exec(ctx, `UPDATE holds SET status = 'refunded', paypal_refund_id = $2, refunded_at = now()
	  WHERE paypal_capture_id = $1 AND (status = 'paid' OR (status = 'refunded' AND paypal_refund_id = $2))`, captureID, refundID)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNoHold
	}
	return err
}
