package studios

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// Danger zone (Figma 99:247): a studio can move a published premiere that has not started, or
// withdraw it. Ticket holders are emailed (Figma 127:127, 127:149); after a move they may take a
// full refund for RefundAfterMove, and a withdrawal queues every paid seat for a refund.

const (
	// RefundAfterMove is how long ticket holders can take a full refund after a move.
	RefundAfterMove = 7 * 24 * time.Hour
	// MoveLead is how far ahead a moved premiere must start, so holders hear in time.
	MoveLead = 24 * time.Hour
)

var ErrStarted = errors.New("the premiere has already started")

// Plan is where a film's premiere stands, for the film page.
type Plan struct {
	ShowtimeID  string     `json:"showtimeId"`
	StartsAt    time.Time  `json:"startsAt"`
	MovedFrom   *time.Time `json:"movedFrom,omitempty"`
	WithdrawnAt *time.Time `json:"withdrawnAt,omitempty"`
	Seats       int        `json:"seats"`      // paid seats
	Holders     int        `json:"holders"`    // accounts holding them
	GrossCents  int64      `json:"grossCents"` // ticket money before the studio share, in USD cents
	SharePct    int        `json:"sharePct"`
	Week        int        `json:"week"` // seats paid in the last 7 days
	RefundsDue  int        `json:"refundsDue"`
}

// livePremiere finds the published showtime of one of the studio's uploads.
func (st Store) livePremiere(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, studio, upload string, lock bool) (string, time.Time, *time.Time, error) {
	if !uuidRe.MatchString(upload) {
		return "", time.Time{}, nil, ErrNotFound
	}
	sql := `SELECT s.id, s.starts_at, s.withdrawn_at FROM studio_premieres p JOIN studio_uploads u ON u.id = p.upload
	  JOIN showtimes s ON s.id = p.showtime_id WHERE p.upload = $1 AND u.studio = $2 AND p.published_at IS NOT NULL`
	if lock {
		sql += ` FOR UPDATE OF s`
	}
	var id string
	var at time.Time
	var gone *time.Time
	err := q.QueryRow(ctx, sql, upload, studio).Scan(&id, &at, &gone)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", at, nil, ErrNotLive
	}
	return id, at, gone, err
}

// PlanOf is the premiere's date and real pre-sales for the film page.
func (st Store) PlanOf(ctx context.Context, acct, email, upload string) (*Plan, error) {
	s, err := st.verified(ctx, acct, email, false)
	if err != nil {
		return nil, err
	}
	id, _, _, err := st.livePremiere(ctx, st.DB, s.Name, upload, false)
	if errors.Is(err, ErrNotLive) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	p := Plan{ShowtimeID: id}
	err = st.DB.QueryRow(ctx, `SELECT s.starts_at, s.moved_from, s.withdrawn_at,
	    coalesce(sum(h.seats) FILTER (WHERE h.status = 'paid'), 0)::int,
	    count(DISTINCT h.account_id) FILTER (WHERE h.status = 'paid')::int,
	    coalesce(sum(coalesce(h.net_cents, h.seats * s.price_cents)) FILTER (WHERE h.status = 'paid'), 0)::bigint,
	    (SELECT share_bps / 100 FROM studios WHERE name = s.studio),
	    coalesce(sum(h.seats) FILTER (WHERE h.status = 'paid' AND h.paid_at > now() - interval '7 days'), 0)::int,
	    count(*) FILTER (WHERE h.refund_due AND h.status = 'paid')::int
	  FROM showtimes s LEFT JOIN holds h ON h.showtime_id = s.id WHERE s.id = $1 GROUP BY s.id`, id).
		Scan(&p.StartsAt, &p.MovedFrom, &p.WithdrawnAt, &p.Seats, &p.Holders, &p.GrossCents, &p.SharePct, &p.Week, &p.RefundsDue)
	return &p, err
}

// Reschedule moves a premiere that has not started. Every ticket holder is emailed and may take a
// full refund for 7 days.
func (st Store) Reschedule(ctx context.Context, acct, email, upload string, starts, now time.Time) (*Plan, error) {
	s, err := st.verified(ctx, acct, email, true)
	if err != nil {
		return nil, err
	}
	starts = starts.UTC().Truncate(time.Minute)
	if starts.Before(now.Add(MoveLead)) {
		return nil, bad("pick a time at least 24 hours from now, so ticket holders hear in time")
	}
	err = pgx.BeginFunc(ctx, st.DB, func(tx pgx.Tx) error {
		id, at, gone, err := st.livePremiere(ctx, tx, s.Name, upload, true)
		if err != nil {
			return err
		}
		if gone != nil {
			return bad("this premiere was withdrawn")
		}
		if !at.After(now) {
			return ErrStarted
		}
		if at.Equal(starts) {
			return bad("that is the time it already has")
		}
		if _, err := tx.Exec(ctx, `UPDATE showtimes SET starts_at = $2, moved_from = coalesce(moved_from, starts_at) WHERE id = $1`, id, starts); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE studio_premieres SET starts_at = $2, updated_at = now() WHERE upload = $1`, upload, starts); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE holds SET refund_until = $2 WHERE showtime_id = $1 AND status = 'paid'`, id, now.Add(RefundAfterMove)); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO mail_outbox (kind, to_email, to_name, data, dedupe)
		  SELECT DISTINCT ON (a.id) 'premiere_moved', a.email, a.name,
		    jsonb_build_object('film', st.film, 'studio', st.studio, 'showtimeId', st.id, 'startsAt', st.starts_at, 'from', $2::timestamptz,
		      'refundUntil', $3::timestamptz, 'ticket', 'EC-T-' || upper(left(replace(h.id::text, '-', ''), 8))),
		    'moved:' || a.id || ':' || st.id || ':' || to_char(st.starts_at, 'YYYYMMDDHH24MI')
		  FROM holds h JOIN showtimes st ON st.id = h.showtime_id JOIN accounts a ON a.id = h.account_id
		  WHERE st.id = $1 AND h.status = 'paid' AND a.delete_after IS NULL
		  ON CONFLICT (dedupe) DO NOTHING`, id, at, now.Add(RefundAfterMove))
		return err
	})
	if err != nil {
		return nil, err
	}
	return st.PlanOf(ctx, acct, email, upload)
}

// Withdraw takes a premiere that has not started off sale and queues every paid seat for a full
// refund; the refund worker pays them back and each holder is emailed as their refund goes out.
// Only the studio's owner can do it.
func (st Store) Withdraw(ctx context.Context, acct, email, upload string, now time.Time) (*Plan, error) {
	s, err := st.verified(ctx, acct, email, true)
	if err != nil {
		return nil, err
	}
	if s.Role != "owner" {
		return nil, ErrForbidden
	}
	err = pgx.BeginFunc(ctx, st.DB, func(tx pgx.Tx) error {
		id, at, gone, err := st.livePremiere(ctx, tx, s.Name, upload, true)
		if err != nil {
			return err
		}
		if gone != nil {
			return nil
		}
		if !at.After(now) {
			return ErrStarted
		}
		if _, err := tx.Exec(ctx, `UPDATE showtimes SET withdrawn_at = $2 WHERE id = $1`, id, now); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE holds SET status = 'released' WHERE showtime_id = $1 AND status = 'held'`, id); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE holds SET refund_due = true WHERE showtime_id = $1 AND status = 'paid'`, id)
		return err
	})
	if err != nil {
		return nil, err
	}
	return st.PlanOf(ctx, acct, email, upload)
}

// RefundDue is a paid seat waiting to be paid back because its premiere was withdrawn.
type RefundDue struct {
	HoldID    string `json:"holdId"`
	AccountID string `json:"accountId"`
	CaptureID string `json:"captureId"`
	Film      string `json:"film"`
}

// RefundsDue lists seats to refund, oldest withdrawal first.
func (st Store) RefundsDue(ctx context.Context, limit int) ([]RefundDue, error) {
	rows, err := st.DB.Query(ctx, `SELECT h.id, coalesce(h.account_id::text, ''), coalesce(h.paypal_capture_id, ''), s.film
	  FROM holds h JOIN showtimes s ON s.id = h.showtime_id
	  WHERE h.refund_due AND h.status = 'paid' ORDER BY s.withdrawn_at, h.id LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (RefundDue, error) {
		var d RefundDue
		err := r.Scan(&d.HoldID, &d.AccountID, &d.CaptureID, &d.Film)
		return d, err
	})
}

// SettleFreeSeat closes a withdrawn seat nobody paid money for (a lottery or gifted seat): the
// seat is freed with nothing to send back.
func (st Store) SettleFreeSeat(ctx context.Context, holdID string) error {
	_, err := st.DB.Exec(ctx, `UPDATE holds SET status = 'refunded', refund_due = false, refunded_at = now(), paypal_refund_id = 'NONE-' || id
	  WHERE id = $1 AND refund_due AND status = 'paid'`, holdID)
	return err
}
