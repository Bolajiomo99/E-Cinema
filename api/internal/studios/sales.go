package studios

import (
	"context"
	"errors"
	"time"
)

// Sales is the Pre-sales tab of the film page: paid seats day by day and by country.
type Sales struct {
	Seats      int          `json:"seats"`
	GrossCents int64        `json:"grossCents"`
	Days       []SalesDay   `json:"days"`      // the last 14 days, oldest first
	Countries  []SalesPlace `json:"countries"` // most seats first
}

type SalesDay struct {
	Day   string `json:"day"` // 2026-11-07
	Seats int    `json:"seats"`
}

type SalesPlace struct {
	Country    string `json:"country"`
	Seats      int    `json:"seats"`
	GrossCents int64  `json:"grossCents"`
}

// SalesOf returns the film's real pre-sales, or nil before the premiere is booked.
func (st Store) SalesOf(ctx context.Context, acct, email, upload string, now time.Time) (*Sales, error) {
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
	out := Sales{Days: []SalesDay{}, Countries: []SalesPlace{}}
	rows, err := st.DB.Query(ctx, `SELECT to_char(d, 'YYYY-MM-DD'), coalesce(sum(h.seats), 0)::int
	  FROM generate_series(date_trunc('day', $2::timestamptz AT TIME ZONE 'UTC') - interval '13 days', date_trunc('day', $2::timestamptz AT TIME ZONE 'UTC'), interval '1 day') d
	  LEFT JOIN holds h ON h.showtime_id = $1 AND h.status = 'paid' AND h.paid_at AT TIME ZONE 'UTC' >= d AND h.paid_at AT TIME ZONE 'UTC' < d + interval '1 day'
	  GROUP BY d ORDER BY d`, id, now)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var d SalesDay
		if err := rows.Scan(&d.Day, &d.Seats); err != nil {
			rows.Close()
			return nil, err
		}
		out.Days = append(out.Days, d)
	}
	rows.Close()
	rows, err = st.DB.Query(ctx, `SELECT coalesce(nullif(a.country, ''), '??'), sum(h.seats)::int, sum(coalesce(h.net_cents, h.seats * s.price_cents))::bigint
	  FROM holds h JOIN showtimes s ON s.id = h.showtime_id LEFT JOIN accounts a ON a.id = h.account_id
	  WHERE h.showtime_id = $1 AND h.status = 'paid' GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 30`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var c SalesPlace
		if err := rows.Scan(&c.Country, &c.Seats, &c.GrossCents); err != nil {
			return nil, err
		}
		out.Seats += c.Seats
		out.GrossCents += c.GrossCents
		out.Countries = append(out.Countries, c)
	}
	return &out, rows.Err()
}
