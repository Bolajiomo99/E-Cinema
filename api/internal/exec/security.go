package exec

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// Security operations (Figma 117:1773): what the platform itself blocked, lock down mode and the
// incident log. Edge traffic (bots, DDoS) needs Cloudflare in front of the site, so it is not counted here.

type SecEvent struct {
	At     time.Time `json:"at"`
	Title  string    `json:"title"`
	Detail string    `json:"detail"`
	Result string    `json:"result"` // blocked, allowed, done, open
}

type Incident struct {
	ID       int64      `json:"id"`
	Title    string     `json:"title"`
	Kind     string     `json:"kind"`
	Severity string     `json:"severity"`
	Note     string     `json:"note"`
	Status   string     `json:"status"`
	By       string     `json:"by"`
	OpenedAt time.Time  `json:"openedAt"`
	ClosedAt *time.Time `json:"closedAt"`
	// An outage can name the screening it broke: everyone watching it gets a free seat (email 31).
	ShowtimeID string     `json:"showtimeId,omitempty"`
	Film       string     `json:"film,omitempty"`
	From       *time.Time `json:"from,omitempty"`
	To         *time.Time `json:"to,omitempty"`
	Countries  []string   `json:"countries,omitempty"`
	Credited   int        `json:"credited"`
}

// Screening is a recent screening an outage can be logged against.
type Screening struct {
	ID       string    `json:"id"`
	Film     string    `json:"film"`
	StartsAt time.Time `json:"startsAt"`
}

type Security struct {
	BlockedToday int         `json:"blockedToday"` // wrong passwords refused today
	Breaches     int         `json:"breaches"`     // logged breaches, 365 days
	Takeovers    int         `json:"takeovers"`    // accounts locked after 10 wrong passwords, 365 days
	OpenCritical int         `json:"openCritical"` // open critical incidents
	LastPenTest  *time.Time  `json:"lastPenTest"`  // newest pen test logged
	WrongPw24h   int         `json:"wrongPw24h"`   // wrong passwords, 24 hours
	Locked24h    int         `json:"locked24h"`    // accounts that hit the lock, 24 hours
	Banned30     int         `json:"banned30"`     // accounts closed for piracy, 30 days
	Leaks30      int         `json:"leaks30"`      // pirate links taken down, 30 days
	Lockdown     bool        `json:"lockdown"`
	LockdownBy   string      `json:"lockdownBy"`
	LockdownAt   *time.Time  `json:"lockdownAt"`
	Passkeys     int         `json:"passkeys"`    // accounts with a passkey
	FaceChecked  int         `json:"faceChecked"` // accounts with a passed face check
	Events       []SecEvent  `json:"events"`
	Incidents    []Incident  `json:"incidents"`
	Screenings   []Screening `json:"screenings"` // started in the last 3 days, for outage credits
	CanEdit      bool        `json:"canEdit"`
}

// CanSecure is who runs security: the CEO and the CTO.
func (st Store) CanSecure(ctx context.Context, email string) error {
	return st.allowed(ctx, email, "cto")
}

func mask(email string) string {
	at := strings.LastIndex(email, "@")
	if at < 1 {
		return "an account"
	}
	r := []rune(email[:at])
	return string(r[0]) + "***" + email[at:]
}

func (st Store) Security(ctx context.Context, email string, now time.Time) (Security, error) {
	s := Security{Events: []SecEvent{}, Incidents: []Incident{}, Screenings: []Screening{}}
	if err := st.CanSecure(ctx, email); err != nil {
		return s, err
	}
	s.CanEdit = true
	lagos := time.FixedZone("WAT", 3600)
	l := now.In(lagos)
	today := time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, lagos)
	if err := st.DB.QueryRow(ctx, `SELECT
	    (SELECT count(*) FROM sign_in_failures WHERE at >= $1)::int,
	    (SELECT count(*) FROM security_incidents WHERE kind = 'breach' AND opened_at >= $2)::int,
	    (SELECT count(*) FROM (SELECT email FROM sign_in_failures WHERE at >= $2 GROUP BY email HAVING count(*) >= 10) x)::int,
	    (SELECT count(*) FROM security_incidents WHERE severity = 'critical' AND status = 'open')::int,
	    (SELECT max(opened_at) FROM security_incidents WHERE kind = 'pentest'),
	    (SELECT count(*) FROM sign_in_failures WHERE at >= $3)::int,
	    (SELECT count(*) FROM (SELECT email FROM sign_in_failures WHERE at >= $3 GROUP BY email HAVING count(*) >= 10) y)::int,
	    (SELECT count(*) FROM accounts WHERE banned_at >= $4)::int,
	    (SELECT count(*) FROM studio_leaks WHERE taken_down_at >= $4)::int,
	    (SELECT count(DISTINCT account_id) FROM passkeys)::int,
	    (SELECT count(*) FROM accounts WHERE face_verified_at IS NOT NULL)::int,
	    lockdown, lockdown_by, lockdown_at
	  FROM security_settings WHERE id = 1`, today, now.AddDate(-1, 0, 0), now.Add(-24*time.Hour), now.AddDate(0, 0, -30)).Scan(
		&s.BlockedToday, &s.Breaches, &s.Takeovers, &s.OpenCritical, &s.LastPenTest, &s.WrongPw24h, &s.Locked24h, &s.Banned30, &s.Leaks30,
		&s.Passkeys, &s.FaceChecked, &s.Lockdown, &s.LockdownBy, &s.LockdownAt); err != nil {
		return s, err
	}
	// Recent events: locked accounts, piracy bans and takedowns, and the incident log, newest first.
	rows, err := st.DB.Query(ctx, `SELECT at, title, detail, result FROM (
	    SELECT max(at) AS at, email AS title, count(*)::text AS detail, 'lock' AS result FROM sign_in_failures WHERE at >= $1 GROUP BY email HAVING count(*) >= 10
	    UNION ALL SELECT banned_at, 'ban', ban_reason, 'blocked' FROM accounts WHERE banned_at >= $1
	    UNION ALL SELECT taken_down_at, 'leak', link, 'done' FROM studio_leaks WHERE taken_down_at >= $1
	  ) e ORDER BY at DESC LIMIT 8`, now.AddDate(0, 0, -30))
	if err != nil {
		return s, err
	}
	for rows.Next() {
		var e SecEvent
		if err := rows.Scan(&e.At, &e.Title, &e.Detail, &e.Result); err != nil {
			rows.Close()
			return s, err
		}
		switch e.Result {
		case "lock":
			e.Title, e.Detail, e.Result = fmt.Sprintf("%s wrong passwords on %s", e.Detail, mask(e.Title)), "Account locked, owner can reset by email", "blocked"
		case "blocked":
			e.Title = "Account closed for piracy"
		default:
			e.Title = "Pirate link taken down"
		}
		s.Events = append(s.Events, e)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return s, err
	}
	if s.Incidents, err = st.incidents(ctx); err != nil {
		return s, err
	}
	srows, err := st.DB.Query(ctx, `SELECT id, film, starts_at FROM showtimes
	  WHERE starts_at <= $1 AND starts_at > $1 - interval '3 days' AND withdrawn_at IS NULL ORDER BY starts_at DESC LIMIT 40`, now)
	if err != nil {
		return s, err
	}
	s.Screenings, err = pgx.CollectRows(srows, func(r pgx.CollectableRow) (Screening, error) {
		var x Screening
		err := r.Scan(&x.ID, &x.Film, &x.StartsAt)
		return x, err
	})
	return s, err
}

func (st Store) incidents(ctx context.Context) ([]Incident, error) {
	rows, err := st.DB.Query(ctx, `SELECT i.id, i.title, i.kind, i.severity, i.note, i.status, i.created_by, i.opened_at, i.closed_at,
	    coalesce(i.showtime_id, ''), coalesce(s.film, ''), i.outage_from, i.outage_to, i.countries, i.credited
	  FROM security_incidents i LEFT JOIN showtimes s ON s.id = i.showtime_id
	  ORDER BY i.status = 'open' DESC, i.opened_at DESC LIMIT 20`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Incident, error) {
		var i Incident
		err := r.Scan(&i.ID, &i.Title, &i.Kind, &i.Severity, &i.Note, &i.Status, &i.By, &i.OpenedAt, &i.ClosedAt,
			&i.ShowtimeID, &i.Film, &i.From, &i.To, &i.Countries, &i.Credited)
		return i, err
	})
}

// SetLockdown turns lock down mode on or off (CEO and CTO).
func (st Store) SetLockdown(ctx context.Context, email string, on bool) error {
	if err := st.CanSecure(ctx, email); err != nil {
		return err
	}
	_, err := st.DB.Exec(ctx, `UPDATE security_settings SET lockdown = $1, lockdown_by = CASE WHEN $1 THEN $2 ELSE '' END,
	  lockdown_at = CASE WHEN $1 THEN now() ELSE NULL END WHERE id = 1`, on, strings.ToLower(email))
	return err
}

var kinds = map[string]bool{"attack": true, "breach": true, "pentest": true, "bounty": true, "outage": true, "other": true}
var severities = map[string]bool{"low": true, "medium": true, "high": true, "critical": true}

// LogIncident adds to the incident log (CEO and CTO).
func (st Store) LogIncident(ctx context.Context, email string, in Incident) (Incident, error) {
	if err := st.CanSecure(ctx, email); err != nil {
		return in, err
	}
	in.Title, in.Note = strings.TrimSpace(in.Title), strings.TrimSpace(in.Note)
	if n := utf8.RuneCountInString(in.Title); n < 3 || n > 140 || utf8.RuneCountInString(in.Note) > 1000 || !kinds[in.Kind] || !severities[in.Severity] {
		return in, fmt.Errorf("%w: a title of 3 to 140 characters, a kind and a severity are needed", ErrBadInput)
	}
	status := "open"
	if in.Kind == "pentest" || in.Kind == "bounty" {
		status = "closed" // a finished test or bounty round is a record, not an open issue
	}
	outage := in.Kind == "outage" && in.ShowtimeID != ""
	var countries []string
	if outage {
		if in.From == nil || in.To == nil || !in.To.After(*in.From) || in.To.Sub(*in.From) > 6*time.Hour {
			return in, fmt.Errorf("%w: give the minutes the picture was lost, up to 6 hours", ErrBadInput)
		}
		seen := map[string]bool{}
		for _, c := range in.Countries {
			c = strings.ToUpper(strings.TrimSpace(c))
			if len(c) != 2 || c[0] < 'A' || c[0] > 'Z' || c[1] < 'A' || c[1] > 'Z' {
				return in, fmt.Errorf("%w: countries are two-letter codes such as NG or GH", ErrBadInput)
			}
			if !seen[c] {
				seen[c] = true
				countries = append(countries, c)
			}
		}
	}
	if countries == nil {
		countries = []string{}
	}
	err := pgx.BeginFunc(ctx, st.DB, func(tx pgx.Tx) error {
		var sid *string
		if outage {
			var starts time.Time
			if err := tx.QueryRow(ctx, `SELECT starts_at FROM showtimes WHERE id = $1`, in.ShowtimeID).Scan(&starts); err != nil {
				return fmt.Errorf("%w: pick a screening from the list", ErrBadInput)
			}
			if in.From.Before(starts.Add(-time.Hour)) || in.To.After(time.Now().Add(time.Minute)) {
				return fmt.Errorf("%w: the outage must fall during that screening and not in the future", ErrBadInput)
			}
			sid = &in.ShowtimeID
		}
		if err := tx.QueryRow(ctx, `INSERT INTO security_incidents (title, kind, severity, note, status, created_by, closed_at, showtime_id, outage_from, outage_to, countries)
		  VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $5 = 'closed' THEN now() END, $7, $8, $9, $10) RETURNING id, status, created_by, opened_at, closed_at`,
			in.Title, in.Kind, in.Severity, in.Note, status, strings.ToLower(email), sid, in.From, in.To, countries).Scan(&in.ID, &in.Status, &in.By, &in.OpenedAt, &in.ClosedAt); err != nil {
			return err
		}
		if !outage {
			in.From, in.To = nil, nil
			return nil
		}
		in.Countries = countries
		// One seat of credit for every ticket holder who was watching (from the countries hit), and
		// email 31 telling them. A seat priced in another currency is credited at the USD price.
		tag, err := tx.Exec(ctx, `WITH hit AS (
		    SELECT DISTINCT ON (a.id) a.id, a.email, a.name, st.film, st.id AS sid, CASE WHEN st.currency = 'USD' THEN st.price_cents ELSE 500 END AS cents
		    FROM holds h JOIN showtimes st ON st.id = h.showtime_id JOIN accounts a ON a.id = h.account_id
		    WHERE h.showtime_id = $2 AND h.status = 'paid' AND a.delete_after IS NULL
		      AND EXISTS (SELECT 1 FROM watch_beats w WHERE w.account_id = a.id AND w.showtime_id = st.id)
		      AND (cardinality($3::text[]) = 0 OR a.country = ANY($3::text[]))),
		  cred AS (
		    INSERT INTO credits (account_id, delta_cents, reason, ref)
		    SELECT id, cents, 'outage', 'outage:' || $1 || ':' || id FROM hit
		    ON CONFLICT (ref) DO NOTHING RETURNING account_id, delta_cents)
		  INSERT INTO mail_outbox (kind, to_email, to_name, data, dedupe)
		  SELECT 'outage_credit', hit.email, hit.name,
		    jsonb_build_object('film', hit.film, 'showtimeId', hit.sid, 'from', $4::timestamptz, 'to', $5::timestamptz,
		      'creditMinor', cred.delta_cents, 'currency', 'USD', 'code', 'SORRY-' || upper(left(md5($1 || ':' || hit.id), 6))),
		    'outage:' || $1 || ':' || hit.id
		  FROM hit JOIN cred ON cred.account_id = hit.id
		  ON CONFLICT (dedupe) DO NOTHING`, strconv.FormatInt(in.ID, 10), in.ShowtimeID, countries, in.From, in.To)
		if err != nil {
			return err
		}
		in.Credited = int(tag.RowsAffected())
		_, err = tx.Exec(ctx, `UPDATE security_incidents SET credited = $2 WHERE id = $1`, in.ID, in.Credited)
		return err
	})
	return in, err
}

// CloseIncident marks an incident handled, or reopens it.
func (st Store) CloseIncident(ctx context.Context, email string, id int64, closed bool) error {
	if err := st.CanSecure(ctx, email); err != nil {
		return err
	}
	tag, err := st.DB.Exec(ctx, `UPDATE security_incidents SET status = CASE WHEN $2 THEN 'closed' ELSE 'open' END,
	  closed_at = CASE WHEN $2 THEN coalesce(closed_at, now()) END WHERE id = $1`, id, closed)
	if err == nil && tag.RowsAffected() == 0 {
		return fmt.Errorf("%w: no such incident", ErrBadInput)
	}
	return err
}
