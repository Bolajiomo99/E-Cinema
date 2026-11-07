package studios

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// Pause is the state of the studio's emergency pause on one premiere.
type Pause struct {
	PausedAt    *time.Time `json:"pausedAt"`
	PausedMs    int64      `json:"pausedMs"`
	DurationMin int        `json:"durationMin"`
}

var errNotPlaying = bad("the premiere is not playing right now")

// SetPause stops or restarts a playing premiere for every viewer (Studio / Live control room,
// "Emergency pause"). Restarting adds the pause to the total, and to the running time, so the
// film still plays to its end and the doors, room and payout all move with it.
func (st Store) SetPause(ctx context.Context, acct, email, upload string, on bool, now time.Time) (Pause, error) {
	sid, _, err := st.LiveShowtime(ctx, acct, email, upload, true)
	if err != nil {
		return Pause{}, err
	}
	var p Pause
	if on {
		err = st.DB.QueryRow(ctx, `UPDATE showtimes SET paused_at = $2
		  WHERE id = $1 AND paused_at IS NULL AND starts_at <= $2
		    AND starts_at + make_interval(mins => duration_min) > $2
		  RETURNING paused_at, paused_ms, duration_min`, sid, now).Scan(&p.PausedAt, &p.PausedMs, &p.DurationMin)
	} else {
		err = st.DB.QueryRow(ctx, `UPDATE showtimes SET
		    paused_ms = paused_ms + (extract(epoch FROM $2::timestamptz - paused_at) * 1000)::bigint,
		    duration_min = duration_min + ceil(extract(epoch FROM $2::timestamptz - paused_at) / 60)::int,
		    paused_at = NULL
		  WHERE id = $1 AND paused_at IS NOT NULL AND paused_at <= $2
		  RETURNING paused_at, paused_ms, duration_min`, sid, now).Scan(&p.PausedAt, &p.PausedMs, &p.DurationMin)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		if on {
			return Pause{}, errNotPlaying
		}
		return Pause{}, bad("the premiere is not paused")
	}
	return p, err
}
