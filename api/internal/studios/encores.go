package studios

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// Encore is one extra screening of a sold-out premiere (Studio / Premieres, "Encores after
// sell-out"). E-Cinema proposes it; it goes on sale only once someone at the studio approves.
type Encore struct {
	N          int        `json:"n"`
	StartsAt   time.Time  `json:"startsAt"`
	Status     string     `json:"status"` // proposed, approved or declined
	ShowtimeID string     `json:"showtimeId,omitempty"`
	Sold       int        `json:"sold"`
	Capacity   int        `json:"capacity"`
	DecidedAt  *time.Time `json:"decidedAt"`
}

// ProposeEncores looks at every published premiere that allows encores. When its latest
// screening (the premiere or its last approved encore) has sold every seat, it proposes the next
// encore, a week later and at least two days out, and tells the studio's owners and admins.
// A declined encore ends the chain. It is idempotent and returns how many it proposed.
func (st Store) ProposeEncores(ctx context.Context, now time.Time) (int, error) {
	rows, err := st.DB.Query(ctx, `WITH chain AS (
	    SELECT p.showtime_id AS origin, p.encores, u.studio, u.title,
	      (SELECT count(*) FROM studio_encores e WHERE e.origin = p.showtime_id) AS made,
	      coalesce((SELECT e.showtime_id FROM studio_encores e WHERE e.origin = p.showtime_id AND e.status = 'approved' ORDER BY e.n DESC LIMIT 1), p.showtime_id) AS latest
	    FROM studio_premieres p JOIN studio_uploads u ON u.id = p.upload JOIN showtimes s ON s.id = p.showtime_id
	    WHERE p.published_at IS NOT NULL AND p.encores > 0 AND s.withdrawn_at IS NULL
	      AND NOT EXISTS (SELECT 1 FROM studio_encores e WHERE e.origin = p.showtime_id AND e.status IN ('proposed', 'declined')))
	  SELECT c.origin, c.made + 1, c.studio, c.title,
	    l.starts_at + make_interval(weeks => greatest(1, ceil(extract(epoch FROM ($1::timestamptz + interval '2 days' - l.starts_at)) / 604800)::int))
	  FROM chain c JOIN showtimes l ON l.id = c.latest
	  WHERE c.made < c.encores AND l.withdrawn_at IS NULL
	    AND (SELECT coalesce(sum(h.seats), 0) FROM holds h WHERE h.showtime_id = l.id AND h.status = 'paid') >= l.capacity`, now)
	if err != nil {
		return 0, err
	}
	type next struct {
		origin, studio, title string
		n                     int
		at                    time.Time
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (next, error) {
		var x next
		return x, r.Scan(&x.origin, &x.n, &x.studio, &x.title, &x.at)
	})
	if err != nil {
		return 0, err
	}
	made := 0
	for _, x := range list {
		tag, err := st.DB.Exec(ctx, `INSERT INTO studio_encores (origin, n, starts_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, x.origin, x.n, x.at)
		if err != nil {
			return made, err
		}
		if tag.RowsAffected() == 0 {
			continue
		}
		made++
		_, err = st.DB.Exec(ctx, `INSERT INTO notifications (account_id, kind, title, body, link, dedupe)
		  SELECT m.account_id, 'premiere', left($2 || ' sold out', 120),
		    left('Approve encore ' || $3 || ' for ' || to_char($4::timestamptz AT TIME ZONE 'UTC', 'FMDay DD Mon, HH24:MI') || ' UTC and it goes on sale at once.', 300),
		    '/studio/premieres', 'encore:' || $5 || ':' || $3
		  FROM studio_members m WHERE m.studio = $1 AND m.account_id IS NOT NULL AND m.role IN ('owner', 'admin')
		  ON CONFLICT DO NOTHING`, x.studio, x.title, fmt.Sprint(x.n), x.at, x.origin)
		if err != nil {
			return made, err
		}
	}
	return made, nil
}

// premiereOf finds the published screening of one of the studio's films.
func (st Store) premiereOf(ctx context.Context, acct, email, upload string, write bool) (origin string, encores int, err error) {
	s, err := st.verified(ctx, acct, email, write)
	if err != nil {
		return "", 0, err
	}
	if !uuidRe.MatchString(upload) {
		return "", 0, ErrNotFound
	}
	var sid *string
	err = st.DB.QueryRow(ctx, `SELECT p.showtime_id, p.encores FROM studio_premieres p JOIN studio_uploads u ON u.id = p.upload
	  WHERE p.upload = $1 AND u.studio = $2`, upload, s.Name).Scan(&sid, &encores)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && sid == nil) {
		return "", 0, ErrNotLive
	}
	if err != nil {
		return "", 0, err
	}
	return *sid, encores, nil
}

// Encores lists the encores proposed for a film, with seats sold on the approved ones.
func (st Store) Encores(ctx context.Context, acct, email, upload string) ([]Encore, error) {
	origin, _, err := st.premiereOf(ctx, acct, email, upload, false)
	if err != nil {
		return nil, err
	}
	rows, err := st.DB.Query(ctx, `SELECT e.n, e.starts_at, e.status, coalesce(e.showtime_id, ''), e.decided_at,
	    coalesce((SELECT sum(h.seats) FROM holds h WHERE h.showtime_id = e.showtime_id AND h.status = 'paid'), 0)::int,
	    coalesce(t.capacity, o.capacity)
	  FROM studio_encores e JOIN showtimes o ON o.id = e.origin LEFT JOIN showtimes t ON t.id = e.showtime_id
	  WHERE e.origin = $1 ORDER BY e.n`, origin)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Encore, error) {
		var e Encore
		return e, r.Scan(&e.N, &e.StartsAt, &e.Status, &e.ShowtimeID, &e.DecidedAt, &e.Sold, &e.Capacity)
	})
}

// DecideEncore approves or declines a proposed encore. Approving creates the screening (same
// film, length, seats and price as the premiere), which goes on sale straight away.
func (st Store) DecideEncore(ctx context.Context, acct, email, upload string, n int, approve bool, now time.Time) (Encore, error) {
	origin, _, err := st.premiereOf(ctx, acct, email, upload, true)
	if err != nil {
		return Encore{}, err
	}
	tx, err := st.DB.Begin(ctx)
	if err != nil {
		return Encore{}, err
	}
	defer tx.Rollback(ctx)
	var at time.Time
	err = tx.QueryRow(ctx, `SELECT starts_at FROM studio_encores WHERE origin = $1 AND n = $2 AND status = 'proposed' FOR UPDATE`, origin, n).Scan(&at)
	if errors.Is(err, pgx.ErrNoRows) {
		return Encore{}, ErrNotFound
	}
	if err != nil {
		return Encore{}, err
	}
	status, sid := "declined", ""
	if approve {
		if !at.After(now) {
			return Encore{}, bad("this encore's date has passed")
		}
		status, sid = "approved", fmt.Sprintf("%s-encore-%d", origin, n)
		if _, err := tx.Exec(ctx, `INSERT INTO showtimes (id, film, studio, starts_at, duration_min, capacity, price_cents, currency, adult, encore_of)
		  SELECT $2, film, studio, $3, duration_min, capacity, price_cents, currency, adult, id FROM showtimes WHERE id = $1`, origin, sid, at); err != nil {
			return Encore{}, err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE studio_encores SET status = $3, showtime_id = NULLIF($4, ''), decided_at = $5, decided_by = $6 WHERE origin = $1 AND n = $2`,
		origin, n, status, sid, now, acct); err != nil {
		return Encore{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Encore{}, err
	}
	return Encore{N: n, StartsAt: at, Status: status, ShowtimeID: sid, DecidedAt: &now}, nil
}
