package exec_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/db"
	"github.com/Bolajiomo99/E-Cinema/api/internal/exec"
)

// Email 31: an outage logged against a screening gives every ticket holder who was watching, in
// the countries hit, one seat of credit, once.
func TestOutageCredit(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	p, err := db.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(p.Close)
	if err := db.Migrate(ctx, p); err != nil {
		t.Fatal(err)
	}
	clean := func() {
		p.Exec(ctx, `DELETE FROM mail_outbox WHERE to_email LIKE 'ox-%'`)
		p.Exec(ctx, `DELETE FROM credits WHERE account_id IN (SELECT id FROM accounts WHERE email LIKE 'ox-%')`)
		p.Exec(ctx, `DELETE FROM security_incidents WHERE created_by = 'ox-ceo@example.com'`)
		p.Exec(ctx, `DELETE FROM watch_beats WHERE showtime_id = 'ox-show'`)
		p.Exec(ctx, `DELETE FROM holds WHERE showtime_id = 'ox-show'`)
		p.Exec(ctx, `DELETE FROM showtimes WHERE id = 'ox-show'`)
		p.Exec(ctx, `DELETE FROM accounts WHERE email LIKE 'ox-%'`)
	}
	clean()
	t.Cleanup(clean)
	st := exec.Store{DB: p, CEOs: []string{"ox-ceo@example.com"}}
	now := time.Now()
	p.Exec(ctx, `INSERT INTO showtimes (id, film, studio, starts_at, duration_min, capacity, price_cents, currency) VALUES ('ox-show', 'Red Earth', 'S', $1, 120, 10, 600, 'USD')`, now.Add(-time.Hour))
	acct := func(email, country string, watched bool) string {
		var id string
		p.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash, country) VALUES ($1, 'Viewer', 'x', $2) RETURNING id`, email, country).Scan(&id)
		if _, err := p.Exec(ctx, `INSERT INTO holds (showtime_id, seats, viewer_ref, status, expires_at, account_id, paypal_order_id, net_cents, paid_at)
		  VALUES ('ox-show', 1, 'ox', 'paid', now(), $1, $2, 600, now())`, id, "ox-"+email); err != nil {
			t.Fatal(err)
		}
		if watched {
			p.Exec(ctx, `INSERT INTO watch_beats (account_id, showtime_id, day, mode, seconds) VALUES ($1, 'ox-show', current_date, 'room', 600)`, id)
		}
		return id
	}
	ng := acct("ox-ng@example.com", "NG", true)
	acct("ox-gb@example.com", "GB", true)
	acct("ox-away@example.com", "NG", false)
	from, to := now.Add(-20*time.Minute), now.Add(-16*time.Minute)
	in := exec.Incident{Title: "Picture lost in West Africa", Kind: "outage", Severity: "high", ShowtimeID: "ox-show", From: &from, To: &to, Countries: []string{"ng", "GH", "NG"}}
	bad := in
	bad.To = &from
	if _, err := st.LogIncident(ctx, "ox-ceo@example.com", bad); !errors.Is(err, exec.ErrBadInput) {
		t.Fatalf("empty window: %v", err)
	}
	out, err := st.LogIncident(ctx, "ox-ceo@example.com", in)
	if err != nil || out.Credited != 1 || len(out.Countries) != 2 {
		t.Fatalf("log: %+v %v", out, err)
	}
	var bal, mails int
	p.QueryRow(ctx, `SELECT coalesce(sum(delta_cents), 0) FROM credits WHERE account_id = $1`, ng).Scan(&bal)
	p.QueryRow(ctx, `SELECT count(*) FROM mail_outbox WHERE kind = 'outage_credit' AND to_email LIKE 'ox-%'`).Scan(&mails)
	if bal != 600 || mails != 1 {
		t.Fatalf("credit %d, mails %d", bal, mails)
	}
	sec, err := st.Security(ctx, "ox-ceo@example.com", now)
	if err != nil || len(sec.Incidents) == 0 || sec.Incidents[0].Film != "Red Earth" || sec.Incidents[0].Credited != 1 {
		t.Fatalf("security: %+v %v", sec.Incidents, err)
	}
	found := false
	for _, s := range sec.Screenings {
		found = found || s.ID == "ox-show"
	}
	if !found {
		t.Fatal("screening not offered")
	}
}
