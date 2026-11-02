package exec

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// Safety and trust (Figma 82:1075): reports, account closures and piracy in one place.

type SafetyCase struct {
	ShowtimeID string    `json:"showtimeId"`
	MessageID  int64     `json:"messageId"`
	Film       string    `json:"film"`
	Body       string    `json:"body"`
	Kind       string    `json:"kind"` // text, voice, image, file
	Reason     string    `json:"reason"`
	Reporters  int       `json:"reporters"`
	Country    string    `json:"country"`
	Hidden     bool      `json:"hidden"`
	At         time.Time `json:"at"`
}

type SafetyLeak struct {
	Place  string    `json:"place"`
	Kind   string    `json:"kind"`
	Film   string    `json:"film"`
	Studio string    `json:"studio"`
	Traced bool      `json:"traced"` // the viewer code in the picture matched a ticket
	Status string    `json:"status"`
	Mins   int       `json:"mins"` // minutes from report to takedown
	At     time.Time `json:"at"`
}

type Safety struct {
	ReportsToday   int          `json:"reportsToday"`
	SettledToday   int          `json:"settledToday"`
	OpenReports    int          `json:"openReports"`
	LeaksDown      int          `json:"leaksDown"` // last 30 days
	AvgTakedownMin int          `json:"avgTakedownMin"`
	Lockouts       int          `json:"lockouts"`      // emails locked out after 10 wrong passwords, 30 days
	RefundRepeats  int          `json:"refundRepeats"` // accounts with 3 or more refunds in 90 days
	Banned         int          `json:"banned"`        // accounts closed in 30 days
	Under13        int          `json:"under13"`       // "may be under 13" reports in 30 days
	Queue          []SafetyCase `json:"queue"`
	Leaks          []SafetyLeak `json:"leaks"`
}

func (st Store) CanModerate(ctx context.Context, email string) error {
	return st.allowed(ctx, email, "coo")
}

func (st Store) Safety(ctx context.Context, email string, now time.Time) (Safety, error) {
	s := Safety{Queue: []SafetyCase{}, Leaks: []SafetyLeak{}}
	if err := st.CanModerate(ctx, email); err != nil {
		return s, err
	}
	lagos := time.FixedZone("WAT", 3600)
	l := now.In(lagos)
	today := time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, lagos)
	month := now.AddDate(0, 0, -30)
	if err := st.DB.QueryRow(ctx, `SELECT
	    (SELECT count(*) FROM room_reports WHERE created_at >= $1) + (SELECT count(*) FROM brand_reports WHERE created_at >= $1) + (SELECT count(*) FROM studio_leaks WHERE created_at >= $1),
	    (SELECT count(*) FROM room_reports WHERE created_at >= $1 AND status <> 'open') + (SELECT count(*) FROM brand_reports WHERE created_at >= $1 AND status NOT IN ('sent', 'checking'))
	      + (SELECT count(*) FROM studio_leaks WHERE created_at >= $1 AND status <> 'open'),
	    (SELECT count(DISTINCT message_id) FROM room_reports WHERE status = 'open'),
	    (SELECT count(*) FROM studio_leaks WHERE taken_down_at >= $2),
	    coalesce((SELECT round(avg(extract(epoch FROM taken_down_at - created_at) / 60)) FROM studio_leaks WHERE taken_down_at >= $2), 0),
	    (SELECT count(*) FROM (SELECT email FROM sign_in_failures WHERE at >= $2 GROUP BY email HAVING count(*) >= 10) x),
	    (SELECT count(*) FROM (SELECT account_id FROM (
	        SELECT account_id FROM shop_refunds WHERE created_at >= $3 AND account_id IS NOT NULL
	        UNION ALL SELECT account_id FROM holds WHERE refunded_at >= $3 AND account_id IS NOT NULL) r GROUP BY account_id HAVING count(*) >= 3) y),
	    (SELECT count(*) FROM accounts WHERE banned_at >= $2),
	    (SELECT count(*) FROM room_reports WHERE reason = 'under13' AND created_at >= $2)`,
		today, month, now.AddDate(0, 0, -90)).Scan(&s.ReportsToday, &s.SettledToday, &s.OpenReports, &s.LeaksDown, &s.AvgTakedownMin,
		&s.Lockouts, &s.RefundRepeats, &s.Banned, &s.Under13); err != nil {
		return s, err
	}
	rows, err := st.DB.Query(ctx, `SELECT r.showtime_id, r.message_id, coalesce(sh.film, r.showtime_id), m.body, m.kind,
	    mode() WITHIN GROUP (ORDER BY r.reason), count(DISTINCT r.reporter_id)::int, m.country, m.hidden, min(r.created_at)
	  FROM room_reports r JOIN room_messages m ON m.id = r.message_id LEFT JOIN showtimes sh ON sh.id = r.showtime_id
	  WHERE r.status = 'open'
	  GROUP BY r.showtime_id, r.message_id, sh.film, m.body, m.kind, m.country, m.hidden
	  ORDER BY count(DISTINCT r.reporter_id) DESC, min(r.created_at) LIMIT 20`)
	if err != nil {
		return s, err
	}
	if s.Queue, err = pgx.CollectRows(rows, pgx.RowToStructByPos[SafetyCase]); err != nil {
		return s, err
	}
	rows, err = st.DB.Query(ctx, `SELECT l.place, l.kind, coalesce(sh.film, ''), l.studio, l.account_id IS NOT NULL, l.status,
	    coalesce(round(extract(epoch FROM l.taken_down_at - l.created_at) / 60), 0)::int, l.created_at
	  FROM studio_leaks l LEFT JOIN showtimes sh ON sh.id = l.showtime_id ORDER BY l.created_at DESC LIMIT 8`)
	if err != nil {
		return s, err
	}
	s.Leaks, err = pgx.CollectRows(rows, pgx.RowToStructByPos[SafetyLeak])
	return s, err
}
