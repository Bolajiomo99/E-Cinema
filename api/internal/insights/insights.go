// Package insights adds up a viewer's own activity for the Insights page (Figma 19:462):
// watch time from player heartbeats, premieres, chat and spending.
package insights

import (
	"context"
	"errors"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Beat is the most watch time one heartbeat can add; beats closer together than MinGap are ignored.
const (
	Beat   = 60
	MinGap = 45 * time.Second
)

var (
	ErrBadInput = errors.New("bad heartbeat")
	langRe      = regexp.MustCompile(`^([a-z]{2,3}(-[A-Z]{2})?)?$`)
)

type Store struct{ DB *pgxpool.Pool }

// Record adds up to one minute of watch time. It reports whether the beat counted.
func (s Store) Record(ctx context.Context, accountID, showtimeID, mode, audio, subs string, seconds int, now time.Time) (bool, error) {
	if (mode != "room" && mode != "replay" && mode != "offline") || !langRe.MatchString(audio) || !langRe.MatchString(subs) || seconds <= 0 {
		return false, ErrBadInput
	}
	if seconds > Beat {
		seconds = Beat
	}
	counted := false
	err := pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `INSERT INTO watch_last (account_id, at) VALUES ($1, $2)
		  ON CONFLICT (account_id) DO UPDATE SET at = EXCLUDED.at WHERE watch_last.at <= $2 - $3::interval`,
			accountID, now, MinGap.String())
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		tag, err = tx.Exec(ctx, `INSERT INTO watch_beats (account_id, showtime_id, day, mode, audio, subs, seconds)
		  SELECT $1, id, ($2::timestamptz AT TIME ZONE 'UTC')::date, $3, $4, $5, $6 FROM showtimes WHERE id = $7
		  ON CONFLICT (account_id, showtime_id, day, mode, audio, subs) DO UPDATE SET seconds = watch_beats.seconds + EXCLUDED.seconds`,
			accountID, now, mode, audio, subs, seconds, showtimeID)
		counted = err == nil && tag.RowsAffected() > 0
		return err
	})
	return counted, err
}

type Totals struct {
	Seconds   int            `json:"seconds"`
	Premieres int            `json:"premieres"`
	Messages  int            `json:"messages"`
	Countries int            `json:"countries"`
	Spent     map[string]int `json:"spent"` // cents by currency
}

type Month struct {
	Month   string `json:"month"` // YYYY-MM
	Seconds int    `json:"seconds"`
}

type FilmTime struct {
	ShowtimeID string `json:"showtimeId"`
	Seconds    int    `json:"seconds"`
}

type LangTime struct {
	Lang    string `json:"lang"`
	Kind    string `json:"kind"` // audio or subs
	Seconds int    `json:"seconds"`
}

type Chat struct {
	Country  string `json:"country"`
	Messages int    `json:"messages"`
}

type Report struct {
	From      time.Time  `json:"from"`
	To        time.Time  `json:"to"`
	Current   Totals     `json:"current"`
	Previous  Totals     `json:"previous"`
	Months    []Month    `json:"months"`
	Films     []FilmTime `json:"films"`
	Languages []LangTime `json:"languages"`
	Chats     []Chat     `json:"chats"`
}

func (s Store) totals(ctx context.Context, accountID string, from, to time.Time) (Totals, error) {
	t := Totals{Spent: map[string]int{}}
	err := s.DB.QueryRow(ctx, `SELECT
	    coalesce((SELECT sum(seconds) FROM watch_beats WHERE account_id = $1 AND day >= ($2::timestamptz AT TIME ZONE 'UTC')::date AND day <= (($3::timestamptz - interval '1 microsecond') AT TIME ZONE 'UTC')::date), 0),
	    (SELECT count(DISTINCT h.showtime_id) FROM holds h JOIN showtimes st ON st.id = h.showtime_id
	       WHERE h.account_id = $1 AND h.status = 'paid' AND st.starts_at >= $2 AND st.starts_at < $3 AND st.starts_at <= now()),
	    (SELECT count(*) FROM room_messages WHERE account_id = $1 AND created_at >= $2 AND created_at < $3),
	    (SELECT count(DISTINCT o.country) FROM room_messages o WHERE o.country <> '' AND o.account_id <> $1 AND o.created_at >= $2 AND o.created_at < $3
	       AND o.showtime_id IN (SELECT showtime_id FROM room_messages WHERE account_id = $1 AND created_at >= $2 AND created_at < $3))`,
		accountID, from, to).Scan(&t.Seconds, &t.Premieres, &t.Messages, &t.Countries)
	if err != nil {
		return t, err
	}
	rows, err := s.DB.Query(ctx, `
	  SELECT cur, sum(c)::int FROM (
	    SELECT st.currency AS cur, coalesce(h.net_cents, h.seats * st.price_cents) AS c FROM holds h JOIN showtimes st ON st.id = h.showtime_id
	      WHERE h.account_id = $1 AND h.status = 'paid' AND h.paypal_capture_id IS NOT NULL AND h.created_at >= $2 AND h.created_at < $3
	    UNION ALL SELECT currency, amount_cents FROM library_keeps WHERE account_id = $1 AND status = 'paid' AND paid_at >= $2 AND paid_at < $3
	    UNION ALL SELECT currency, amount_cents FROM gifts WHERE giver_id = $1 AND status IN ('paid', 'redeemed') AND created_at >= $2 AND created_at < $3
	    UNION ALL SELECT currency, amount_cents FROM adult_stages WHERE account_id = $1 AND status = 'paid' AND paid_at >= $2 AND paid_at < $3
	  ) x GROUP BY cur`, accountID, from, to)
	if err != nil {
		return t, err
	}
	defer rows.Close()
	for rows.Next() {
		var cur string
		var c int
		if err := rows.Scan(&cur, &c); err != nil {
			return t, err
		}
		t.Spent[cur] = c
	}
	return t, rows.Err()
}

// Report gathers the page for a period [from, to), with the period before it for comparison.
func (s Store) Report(ctx context.Context, accountID string, from, to, now time.Time) (Report, error) {
	r := Report{From: from, To: to}
	var err error
	if r.Current, err = s.totals(ctx, accountID, from, to); err != nil {
		return r, err
	}
	if r.Previous, err = s.totals(ctx, accountID, from.Add(-to.Sub(from)), from); err != nil {
		return r, err
	}
	// Always the last six calendar months, for the bar chart.
	start := time.Date(now.Year(), now.Month()-5, 1, 0, 0, 0, 0, time.UTC)
	rows, err := s.DB.Query(ctx, `SELECT to_char(m, 'YYYY-MM'), coalesce((SELECT sum(seconds) FROM watch_beats
	    WHERE account_id = $1 AND day >= m AND day < m + interval '1 month'), 0)
	  FROM generate_series($2::date, $3::date, interval '1 month') m ORDER BY m`, accountID, start, now)
	if err != nil {
		return r, err
	}
	if r.Months, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (Month, error) {
		var m Month
		return m, row.Scan(&m.Month, &m.Seconds)
	}); err != nil {
		return r, err
	}
	rows, err = s.DB.Query(ctx, `SELECT showtime_id, sum(seconds)::int FROM watch_beats WHERE account_id = $1 AND day >= ($2::timestamptz AT TIME ZONE 'UTC')::date AND day <= (($3::timestamptz - interval '1 microsecond') AT TIME ZONE 'UTC')::date
	  GROUP BY showtime_id ORDER BY 2 DESC`, accountID, from, to)
	if err != nil {
		return r, err
	}
	if r.Films, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (FilmTime, error) {
		var f FilmTime
		return f, row.Scan(&f.ShowtimeID, &f.Seconds)
	}); err != nil {
		return r, err
	}
	rows, err = s.DB.Query(ctx, `SELECT lang, kind, sum(seconds)::int FROM (
	    SELECT audio AS lang, 'audio' AS kind, seconds FROM watch_beats WHERE account_id = $1 AND day >= ($2::timestamptz AT TIME ZONE 'UTC')::date AND day <= (($3::timestamptz - interval '1 microsecond') AT TIME ZONE 'UTC')::date AND audio <> ''
	    UNION ALL SELECT subs, 'subs', seconds FROM watch_beats WHERE account_id = $1 AND day >= ($2::timestamptz AT TIME ZONE 'UTC')::date AND day <= (($3::timestamptz - interval '1 microsecond') AT TIME ZONE 'UTC')::date AND subs <> ''
	    UNION ALL SELECT '', 'audio', seconds FROM watch_beats WHERE account_id = $1 AND day >= ($2::timestamptz AT TIME ZONE 'UTC')::date AND day <= (($3::timestamptz - interval '1 microsecond') AT TIME ZONE 'UTC')::date AND audio = ''
	  ) x GROUP BY lang, kind ORDER BY 3 DESC LIMIT 8`, accountID, from, to)
	if err != nil {
		return r, err
	}
	if r.Languages, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (LangTime, error) {
		var l LangTime
		return l, row.Scan(&l.Lang, &l.Kind, &l.Seconds)
	}); err != nil {
		return r, err
	}
	rows, err = s.DB.Query(ctx, `SELECT o.country, count(*)::int FROM room_messages o
	  WHERE o.country <> '' AND o.account_id <> $1 AND o.hidden = false AND o.created_at >= $2 AND o.created_at < $3
	    AND o.showtime_id IN (SELECT showtime_id FROM room_messages WHERE account_id = $1 AND created_at >= $2 AND created_at < $3)
	  GROUP BY o.country ORDER BY 2 DESC LIMIT 6`, accountID, from, to)
	if err != nil {
		return r, err
	}
	r.Chats, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (Chat, error) {
		var c Chat
		return c, row.Scan(&c.Country, &c.Messages)
	})
	return r, err
}
