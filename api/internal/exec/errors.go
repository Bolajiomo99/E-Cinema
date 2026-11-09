package exec

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Bolajiomo99/E-Cinema/api/internal/notify"
)

// Error alerts: crashes from viewers' browsers, the web server and this API, grouped by
// fingerprint. A new problem (or one that comes back after being marked fixed) emails the CEO
// and the CTO at most once every six hours; the Infrastructure page lists them all.

type AppError struct {
	Fingerprint string     `json:"fingerprint"`
	Source      string     `json:"source"`
	Message     string     `json:"message"`
	Stack       string     `json:"stack"`
	Path        string     `json:"path"`
	Agent       string     `json:"agent"`
	Release     string     `json:"release"`
	Count       int        `json:"count"`
	FirstSeen   time.Time  `json:"firstSeen"`
	LastSeen    time.Time  `json:"lastSeen"`
	ResolvedAt  *time.Time `json:"resolvedAt,omitempty"`
}

const alertEvery = 6 * time.Hour

func clip(s string, n int) string {
	s = strings.ToValidUTF8(strings.TrimSpace(s), "")
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}

// fingerprint groups sightings of the same problem: the source, the message with numbers taken
// out (ids and counts change between sightings) and the first line of the stack that names a file.
func fingerprint(source, message, stack string) string {
	var b strings.Builder
	for _, r := range message {
		if r >= '0' && r <= '9' {
			continue
		}
		b.WriteRune(r)
	}
	frame := ""
	for _, line := range strings.Split(stack, "\n") {
		if strings.Contains(line, ".js") || strings.Contains(line, ".go") || strings.Contains(line, ".ts") {
			frame = strings.TrimSpace(line)
			break
		}
	}
	sum := sha256.Sum256([]byte(source + "\x00" + b.String() + "\x00" + frame))
	return hex.EncodeToString(sum[:12])
}

// RecordError stores one sighting and queues an alert email when the problem is new, came back
// after being fixed, or was last alerted more than six hours ago.
func (st Store) RecordError(ctx context.Context, e AppError, now time.Time) (AppError, error) {
	switch e.Source {
	case "browser", "web", "api":
	default:
		return e, errors.New("unknown source")
	}
	e.Message, e.Stack = clip(e.Message, 500), clip(e.Stack, 4000)
	e.Path, e.Agent, e.Release = clip(e.Path, 300), clip(e.Agent, 300), clip(e.Release, 60)
	if e.Message == "" {
		return e, errors.New("an error needs a message")
	}
	e.Fingerprint = fingerprint(e.Source, e.Message, e.Stack)
	var alert bool
	err := st.DB.QueryRow(ctx, `
	  WITH prev AS (SELECT alerted_at, resolved_at FROM app_errors WHERE fingerprint = $1)
	  INSERT INTO app_errors (fingerprint, source, message, stack, path, agent, release, first_seen, last_seen, alerted_at)
	  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $8)
	  ON CONFLICT (fingerprint) DO UPDATE SET
	    count = app_errors.count + 1, last_seen = $8, path = $5, agent = $6, release = $7,
	    stack = CASE WHEN $4 <> '' THEN $4 ELSE app_errors.stack END,
	    resolved_at = NULL,
	    alerted_at = CASE WHEN app_errors.resolved_at IS NOT NULL OR app_errors.alerted_at IS NULL OR app_errors.alerted_at < $8 - $9::interval
	                      THEN $8 ELSE app_errors.alerted_at END
	  RETURNING count, first_seen, alerted_at = $8`,
		e.Fingerprint, e.Source, e.Message, e.Stack, e.Path, e.Agent, e.Release, now, alertEvery.String()).Scan(&e.Count, &e.FirstSeen, &alert)
	if err != nil {
		return e, err
	}
	e.LastSeen = now
	if alert {
		st.alertError(ctx, e, now)
	}
	return e, nil
}

func (st Store) alertError(ctx context.Context, e AppError, now time.Time) {
	to := map[string]bool{}
	for _, c := range st.CEOs {
		if c != "" {
			to[c] = true
		}
	}
	rows, err := st.DB.Query(ctx, `SELECT email FROM executives WHERE role = 'cto' AND NOT pending AND (expires_on IS NULL OR expires_on >= current_date)`)
	if err == nil {
		for rows.Next() {
			var m string
			if rows.Scan(&m) == nil {
				to[strings.ToLower(m)] = true
			}
		}
		rows.Close()
	}
	mail := notify.Store{DB: st.DB}
	for addr := range to {
		_ = mail.Queue(ctx, notify.Mail{Kind: "error_alert", To: addr,
			Dedupe: "error:" + e.Fingerprint + ":" + addr + ":" + now.UTC().Format("2006-01-02T15:04"),
			Data: map[string]any{"source": e.Source, "message": e.Message, "path": e.Path, "count": e.Count,
				"firstSeen": e.FirstSeen, "stack": clip(e.Stack, 1200), "release": e.Release}})
	}
}

// Errors lists the problems seen in the last 30 days, open ones first, for the CTO and CEO.
func (st Store) Errors(ctx context.Context, email string, now time.Time) ([]AppError, error) {
	out := []AppError{}
	if err := st.allowed(ctx, email, "cto"); err != nil {
		return out, err
	}
	rows, err := st.DB.Query(ctx, `SELECT fingerprint, source, message, stack, path, agent, release, count, first_seen, last_seen, resolved_at
	  FROM app_errors WHERE last_seen >= $1 ORDER BY resolved_at IS NOT NULL, last_seen DESC LIMIT 100`, now.AddDate(0, 0, -30))
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var e AppError
		if err := rows.Scan(&e.Fingerprint, &e.Source, &e.Message, &e.Stack, &e.Path, &e.Agent, &e.Release, &e.Count, &e.FirstSeen, &e.LastSeen, &e.ResolvedAt); err != nil {
			return out, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// ResolveError marks a problem fixed; it reopens (and alerts again) if it is seen after this.
func (st Store) ResolveError(ctx context.Context, email, fp string, now time.Time) error {
	if err := st.allowed(ctx, email, "cto"); err != nil {
		return err
	}
	tag, err := st.DB.Exec(ctx, `UPDATE app_errors SET resolved_at = $2 WHERE fingerprint = $1`, fp, now)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}
