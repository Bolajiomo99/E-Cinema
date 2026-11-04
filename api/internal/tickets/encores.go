package tickets

import (
	"context"
	"time"
)

// EncoreAhead is how far ahead weekly encores are created. The web shows them only 8 weeks ahead
// (web/lib/encores.ts), so a row always exists before a viewer can book it.
const EncoreAhead = 9 * 7 * 24 * time.Hour

// EnsureEncores creates the weekly encores of the launch lineup (migration 060) up to EncoreAhead
// from now: same film, weekday, time, price and capacity, once the premiere has started. It is
// idempotent and returns how many new screenings it added.
func (st Store) EnsureEncores(ctx context.Context, now time.Time) (int64, error) {
	tag, err := st.DB.Exec(ctx, `INSERT INTO showtimes (id, film, studio, starts_at, duration_min, capacity, price_cents, currency, adult, encore_of)
	  SELECT regexp_replace(b.id, '-[0-9]{4}-[0-9]{2}-[0-9]{2}$', '') || '-' || to_char(slot AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
	         b.film, b.studio, slot, b.duration_min, b.capacity, b.price_cents, b.currency, b.adult, b.id
	  FROM showtimes b, LATERAL generate_series(b.starts_at + interval '7 days', $1::timestamptz + make_interval(secs => $2), interval '7 days') slot
	  WHERE b.encore_weekly AND b.starts_at <= $1 AND slot > $1::timestamptz - interval '1 day'
	  ON CONFLICT (id) DO NOTHING`, now, EncoreAhead.Seconds())
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
