package studios

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"time"
)

// Studio notification emails (Figma 39:1184, Settings · Notifications). Each member chooses
// which of these they get; they are read from what already happened, like the notices.
var AlertKinds = []string{"milestones", "incidents", "leaks", "weekly"}

// Alerts returns the emails this member gets.
func (st Store) Alerts(ctx context.Context, acct, email string) ([]string, error) {
	s, err := st.verified(ctx, acct, email, false)
	if err != nil {
		return nil, err
	}
	var out []string
	err = st.DB.QueryRow(ctx, `SELECT alerts FROM studio_members WHERE studio = $1 AND lower(email) = lower($2)`, s.Name, email).Scan(&out)
	if out == nil {
		out = []string{}
	}
	return out, err
}

// SetAlert turns one kind of email on or off for this member only.
func (st Store) SetAlert(ctx context.Context, acct, email, kind string, on bool) ([]string, error) {
	if !slices.Contains(AlertKinds, kind) {
		return nil, fmt.Errorf("%w: unknown notification", ErrBadInput)
	}
	s, err := st.verified(ctx, acct, email, false)
	if err != nil {
		return nil, err
	}
	q := `UPDATE studio_members SET alerts = array_remove(alerts, $3) WHERE studio = $1 AND lower(email) = lower($2) RETURNING alerts`
	if on {
		q = `UPDATE studio_members SET alerts = array_append(array_remove(alerts, $3), $3) WHERE studio = $1 AND lower(email) = lower($2) RETURNING alerts`
	}
	var out []string
	err = st.DB.QueryRow(ctx, q, s.Name, email, kind).Scan(&out)
	if out == nil {
		out = []string{}
	}
	return out, err
}

// Milestone is the highest of 25, 50 and 100 percent of seats sold that has been reached.
func Milestone(sold, capacity int) int {
	if capacity <= 0 {
		return 0
	}
	switch {
	case sold >= capacity:
		return 100
	case sold*2 >= capacity:
		return 50
	case sold*4 >= capacity:
		return 25
	}
	return 0
}

// mailMembers queues one email per member of the studio who wants this kind. The dedupe key
// gets the member's email added, so a member is told once.
func (st Store) mailMembers(ctx context.Context, studio, alert, kind, dedupe string, data map[string]any, skip string) (int, error) {
	b, _ := json.Marshal(data)
	tag, err := st.DB.Exec(ctx, `INSERT INTO mail_outbox (kind, to_email, to_name, data, dedupe)
	  SELECT $3, m.email, coalesce(a.name, ''), $4::jsonb || jsonb_build_object('studio', m.studio), $5 || ':' || lower(m.email)
	  FROM studio_members m LEFT JOIN accounts a ON a.id = m.account_id
	  WHERE m.studio = $1 AND $2 = ANY (m.alerts) AND ($6 = '' OR m.account_id IS NULL OR m.account_id::text <> $6)
	  ON CONFLICT (dedupe) DO NOTHING`, studio, alert, kind, string(b), dedupe, skip)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

// QueueAlerts queues the studio notification emails that are due: seat milestones for premieres
// still ahead, incidents logged on a studio's screening and leaks reported by someone else in
// the last day, and the weekly report on Monday from 08:00 Lagos.
func (st Store) QueueAlerts(ctx context.Context, now time.Time) (int, error) {
	n := 0
	type mile struct {
		id, film, studio, upload string
		starts                   time.Time
		sold, capacity           int
	}
	rows, err := st.DB.Query(ctx, `SELECT s.id, s.film, s.studio, coalesce(p.upload::text, ''), s.starts_at, s.capacity,
	    coalesce((SELECT sum(h.seats) FROM holds h WHERE h.showtime_id = s.id AND h.status = 'paid'), 0)::int
	  FROM showtimes s LEFT JOIN studio_premieres p ON p.showtime_id = s.id
	  WHERE s.studio IN (SELECT name FROM studios) AND s.withdrawn_at IS NULL AND s.starts_at > $1 AND s.capacity > 0`, now)
	if err != nil {
		return 0, err
	}
	var miles []mile
	for rows.Next() {
		var m mile
		if err := rows.Scan(&m.id, &m.film, &m.studio, &m.upload, &m.starts, &m.capacity, &m.sold); err != nil {
			rows.Close()
			return n, err
		}
		miles = append(miles, m)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return n, err
	}
	for _, m := range miles {
		pct := Milestone(m.sold, m.capacity)
		if pct == 0 {
			continue
		}
		k, err := st.mailMembers(ctx, m.studio, "milestones", "studio_milestone", fmt.Sprintf("stmile:%s:%d", m.id, pct),
			map[string]any{"film": m.film, "pct": pct, "sold": m.sold, "capacity": m.capacity, "startsAt": m.starts, "upload": m.upload}, "")
		if err != nil {
			return n, err
		}
		n += k
	}

	// Incidents an executive logged on one of the studio's screenings.
	type inc struct {
		id, studio, film, title, note string
		from, to                      *time.Time
	}
	rows, err = st.DB.Query(ctx, `SELECT i.id::text, s.studio, s.film, i.title, i.note, i.outage_from, i.outage_to
	  FROM security_incidents i JOIN showtimes s ON s.id = i.showtime_id
	  WHERE i.kind = 'outage' AND s.studio IN (SELECT name FROM studios) AND i.opened_at > $1::timestamptz - interval '1 day'`, now)
	if err != nil {
		return n, err
	}
	var incs []inc
	for rows.Next() {
		var i inc
		if err := rows.Scan(&i.id, &i.studio, &i.film, &i.title, &i.note, &i.from, &i.to); err != nil {
			rows.Close()
			return n, err
		}
		incs = append(incs, i)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return n, err
	}
	for _, i := range incs {
		mins := 0
		if i.from != nil && i.to != nil {
			mins = int(i.to.Sub(*i.from).Round(time.Minute).Minutes())
		}
		k, err := st.mailMembers(ctx, i.studio, "incidents", "studio_incident", "stinc:"+i.id,
			map[string]any{"film": i.film, "title": i.title, "note": i.note, "minutes": mins, "ref": i.id}, "")
		if err != nil {
			return n, err
		}
		n += k
	}

	// Leaks reported in the last day; the person who reported one is not told about it.
	type leak struct{ id, studio, film, place, kind, reporter string }
	rows, err = st.DB.Query(ctx, `SELECT l.id::text, l.studio, coalesce(s.film, ''), l.place, l.kind, coalesce(l.reported_by::text, '')
	  FROM studio_leaks l LEFT JOIN showtimes s ON s.id = l.showtime_id WHERE l.created_at > $1::timestamptz - interval '1 day'`, now)
	if err != nil {
		return n, err
	}
	var leaks []leak
	for rows.Next() {
		var l leak
		if err := rows.Scan(&l.id, &l.studio, &l.film, &l.place, &l.kind, &l.reporter); err != nil {
			rows.Close()
			return n, err
		}
		leaks = append(leaks, l)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return n, err
	}
	for _, l := range leaks {
		k, err := st.mailMembers(ctx, l.studio, "leaks", "studio_leak", "stleak:"+l.id,
			map[string]any{"film": l.film, "place": l.place, "what": l.kind, "ref": l.id}, l.reporter)
		if err != nil {
			return n, err
		}
		n += k
	}

	k, err := st.queueWeekly(ctx, now)
	return n + k, err
}

var lagos = time.FixedZone("WAT", 3600)

// queueWeekly sends last week's report (Monday to Sunday, Lagos time) from 08:00 Lagos on Monday.
func (st Store) queueWeekly(ctx context.Context, now time.Time) (int, error) {
	l := now.In(lagos)
	if l.Weekday() != time.Monday || l.Hour() < 8 {
		return 0, nil
	}
	end := time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, lagos)
	start := end.AddDate(0, 0, -7)
	y, w := start.ISOWeek()
	type week struct {
		studio                  string
		shareBps                int
		seats, films, countries int
		grossCents              int64
		topFilm                 string
		topSeats, openLeaks     int
	}
	rows, err := st.DB.Query(ctx, `SELECT st.name, st.share_bps,
	    coalesce(sum(h.seats), 0)::int, coalesce(sum(coalesce(h.net_cents, h.seats * s.price_cents)), 0)::bigint,
	    count(DISTINCT s.id) FILTER (WHERE h.id IS NOT NULL)::int, count(DISTINCT nullif(a.country, '')) FILTER (WHERE h.id IS NOT NULL)::int,
	    (SELECT count(*) FROM studio_leaks x WHERE x.studio = st.name AND x.status IN ('open', 'takedown_sent'))::int
	  FROM studios st
	  LEFT JOIN showtimes s ON s.studio = st.name
	  LEFT JOIN holds h ON h.showtime_id = s.id AND h.status = 'paid' AND h.paid_at >= $1 AND h.paid_at < $2
	  LEFT JOIN accounts a ON a.id = h.account_id
	  WHERE st.verified_at IS NOT NULL GROUP BY st.name, st.share_bps`, start, end)
	if err != nil {
		return 0, err
	}
	var list []week
	for rows.Next() {
		var x week
		if err := rows.Scan(&x.studio, &x.shareBps, &x.seats, &x.grossCents, &x.films, &x.countries, &x.openLeaks); err != nil {
			rows.Close()
			return 0, err
		}
		list = append(list, x)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	n := 0
	for _, x := range list {
		if x.seats == 0 && x.openLeaks == 0 {
			continue // nothing to report
		}
		_ = st.DB.QueryRow(ctx, `SELECT s.film, sum(h.seats)::int FROM holds h JOIN showtimes s ON s.id = h.showtime_id
		  WHERE s.studio = $1 AND h.status = 'paid' AND h.paid_at >= $2 AND h.paid_at < $3 GROUP BY s.film ORDER BY 2 DESC LIMIT 1`, x.studio, start, end).Scan(&x.topFilm, &x.topSeats)
		k, err := st.mailMembers(ctx, x.studio, "weekly", "studio_weekly", fmt.Sprintf("stweek:%s:%d-%02d", x.studio, y, w), map[string]any{
			"from": start.Format("2006-01-02"), "to": end.AddDate(0, 0, -1).Format("2006-01-02"), "seats": x.seats, "grossCents": x.grossCents,
			"shareCents": x.grossCents * int64(x.shareBps) / 10000, "films": x.films, "countries": x.countries, "topFilm": x.topFilm, "topSeats": x.topSeats, "openLeaks": x.openLeaks,
		}, "")
		if err != nil {
			return n, err
		}
		n += k
	}
	return n, nil
}
