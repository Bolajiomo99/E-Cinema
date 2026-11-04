package notify_test

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/db"
	"github.com/Bolajiomo99/E-Cinema/api/internal/notify"
)

// Email 22: a member quiet for 60 days gets one free seat for the next premiere with empty seats,
// once, naming someone they watched with before who is going.
func TestWinback(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	p, err := db.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	if err := db.Migrate(ctx, p); err != nil {
		t.Fatal(err)
	}
	s := notify.Store{DB: p}
	// A Wednesday, 10:30 UTC, well ahead so no real premiere competes.
	now := time.Date(2031, 1, 1, 10, 30, 0, 0, time.UTC)
	for now.Weekday() != time.Wednesday {
		now = now.AddDate(0, 0, 1)
	}
	clean := func() {
		p.Exec(ctx, `DELETE FROM mail_outbox WHERE to_email LIKE 'wb-%'`)
		p.Exec(ctx, `DELETE FROM credits WHERE account_id IN (SELECT id FROM accounts WHERE email LIKE 'wb-%')`)
		p.Exec(ctx, `DELETE FROM parties WHERE showtime_id LIKE 'wb-%'`)
		p.Exec(ctx, `DELETE FROM holds WHERE showtime_id LIKE 'wb-%'`)
		p.Exec(ctx, `DELETE FROM showtimes WHERE id LIKE 'wb-%'`)
		p.Exec(ctx, `DELETE FROM accounts WHERE email LIKE 'wb-%'`)
	}
	clean()
	t.Cleanup(clean)
	// Other future premieres in the test database would be picked first; keep them out of the way.
	p.Exec(ctx, `INSERT INTO showtimes (id, film, studio, starts_at, duration_min, capacity, price_cents, currency) VALUES
	  ('wb-old', 'Old Film', 'S', $1::timestamptz - interval '120 days', 90, 10, 500, 'USD'),
	  ('wb-full', 'Full Film', 'S', $1::timestamptz + interval '2 days', 90, 1, 500, 'USD'),
	  ('wb-next', 'Red Earth', 'S', $1::timestamptz + interval '3 days', 90, 50, 700, 'USD')`, now)
	acct := func(email, name string, age time.Duration) string {
		var id string
		p.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash, country, created_at) VALUES ($1, $2, 'x', 'NG', $3) RETURNING id`, email, name, now.Add(-age)).Scan(&id)
		return id
	}
	quiet := acct("wb-quiet@example.com", "Tolu Bankole", 200*24*time.Hour)
	friend := acct("wb-friend@example.com", "Adaeze Okafor", 200*24*time.Hour)
	acct("wb-new@example.com", "New Person", 10*24*time.Hour)
	never := acct("wb-never@example.com", "Never Booked", 200*24*time.Hour)
	_ = never
	seat := func(show, who string, at time.Time) {
		if _, err := p.Exec(ctx, `INSERT INTO holds (showtime_id, seats, viewer_ref, status, expires_at, account_id, paypal_order_id, net_cents, created_at, paid_at)
		  VALUES ($1, 1, 'wb', 'paid', $3, $2, 'wb-' || gen_random_uuid(), 500, $3, $3)`, show, who, at); err != nil {
			t.Fatal(err)
		}
	}
	seat("wb-old", quiet, now.AddDate(0, 0, -121))
	seat("wb-old", friend, now.AddDate(0, 0, -121))
	seat("wb-full", friend, now.AddDate(0, 0, -1))
	seat("wb-next", friend, now.AddDate(0, 0, -1))
	var party string
	p.QueryRow(ctx, `INSERT INTO parties (code, showtime_id, host_id, name, visibility) VALUES ('wb-code1', 'wb-old', $1, 'Old night', 'invite') RETURNING id`, friend).Scan(&party)
	p.Exec(ctx, `INSERT INTO party_members (party_id, account_id) VALUES ($1, $2)`, party, quiet)

	// Not on a Tuesday.
	s.ScheduleMail(ctx, now.AddDate(0, 0, -1))
	for i := 0; i < 2; i++ {
		if _, err := s.ScheduleMail(ctx, now); err != nil {
			t.Fatal(err)
		}
	}
	rows, _ := p.Query(ctx, `SELECT to_email, data FROM mail_outbox WHERE kind = 'winback' AND to_email LIKE 'wb-%'`)
	got := map[string]map[string]any{}
	for rows.Next() {
		var e string
		var raw []byte
		rows.Scan(&e, &raw)
		var d map[string]any
		json.Unmarshal(raw, &d)
		got[e] = d
	}
	rows.Close()
	d := got["wb-quiet@example.com"]
	if len(got) != 1 || d == nil || d["film"] != "Red Earth" || d["friend"] != "Adaeze" || d["friends"].(float64) != 1 || d["creditMinor"].(float64) != 700 {
		t.Fatalf("winback mail: %v", got)
	}
	var bal int
	p.QueryRow(ctx, `SELECT coalesce(sum(delta_cents), 0) FROM credits WHERE account_id = $1`, quiet).Scan(&bal)
	if bal != 700 {
		t.Fatalf("credit %d", bal)
	}
	// Next week: no second free seat within 180 days.
	s.ScheduleMail(ctx, now.AddDate(0, 0, 7))
	var n int
	p.QueryRow(ctx, `SELECT count(*) FROM mail_outbox WHERE kind = 'winback' AND to_email LIKE 'wb-%'`).Scan(&n)
	if n != 1 {
		t.Fatalf("second winback: %d", n)
	}
}
