package exec

import (
	"context"
	"fmt"
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
}

type Security struct {
	BlockedToday int        `json:"blockedToday"` // wrong passwords refused today
	Breaches     int        `json:"breaches"`     // logged breaches, 365 days
	Takeovers    int        `json:"takeovers"`    // accounts locked after 10 wrong passwords, 365 days
	OpenCritical int        `json:"openCritical"` // open critical incidents
	LastPenTest  *time.Time `json:"lastPenTest"`  // newest pen test logged
	WrongPw24h   int        `json:"wrongPw24h"`   // wrong passwords, 24 hours
	Locked24h    int        `json:"locked24h"`    // accounts that hit the lock, 24 hours
	Banned30     int        `json:"banned30"`     // accounts closed for piracy, 30 days
	Leaks30      int        `json:"leaks30"`      // pirate links taken down, 30 days
	Lockdown     bool       `json:"lockdown"`
	LockdownBy   string     `json:"lockdownBy"`
	LockdownAt   *time.Time `json:"lockdownAt"`
	Passkeys     int        `json:"passkeys"`    // accounts with a passkey
	FaceChecked  int        `json:"faceChecked"` // accounts with a passed face check
	Events       []SecEvent `json:"events"`
	Incidents    []Incident `json:"incidents"`
	CanEdit      bool       `json:"canEdit"`
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
	s := Security{Events: []SecEvent{}, Incidents: []Incident{}}
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
			e.Title, e.Detail = "Account closed for piracy", e.Detail
		default:
			e.Title, e.Detail = "Pirate link taken down", e.Detail
		}
		s.Events = append(s.Events, e)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return s, err
	}
	s.Incidents, err = st.incidents(ctx)
	return s, err
}

func (st Store) incidents(ctx context.Context) ([]Incident, error) {
	rows, err := st.DB.Query(ctx, `SELECT id, title, kind, severity, note, status, created_by, opened_at, closed_at FROM security_incidents
	  ORDER BY status = 'open' DESC, opened_at DESC LIMIT 20`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Incident, error) {
		var i Incident
		err := r.Scan(&i.ID, &i.Title, &i.Kind, &i.Severity, &i.Note, &i.Status, &i.By, &i.OpenedAt, &i.ClosedAt)
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
	err := st.DB.QueryRow(ctx, `INSERT INTO security_incidents (title, kind, severity, note, status, created_by, closed_at)
	  VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $5 = 'closed' THEN now() END) RETURNING id, status, created_by, opened_at, closed_at`,
		in.Title, in.Kind, in.Severity, in.Note, status, strings.ToLower(email)).Scan(&in.ID, &in.Status, &in.By, &in.OpenedAt, &in.ClosedAt)
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
