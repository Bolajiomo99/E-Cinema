package notify_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/db"
	"github.com/Bolajiomo99/E-Cinema/api/internal/notify"
)

func TestNotify(t *testing.T) {
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
	p.Exec(ctx, `DELETE FROM holds WHERE showtime_id LIKE 'ntf-%'`)
	p.Exec(ctx, `DELETE FROM notifications WHERE account_id IN (SELECT id FROM accounts WHERE email LIKE 'ntf-%@example.com')`)
	p.Exec(ctx, `INSERT INTO showtimes VALUES ('ntf-soon', 'Soon Film', 'S', now() + interval '40 minutes', 90, 10, 500, 'USD'),
	  ('ntf-later', 'Later Film', 'S', now() + interval '3 hours', 90, 10, 500, 'USD') ON CONFLICT (id) DO UPDATE SET starts_at = EXCLUDED.starts_at`)
	var a string
	p.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash) VALUES ('ntf-a@example.com', 'Ada', 'x') ON CONFLICT (email) DO UPDATE SET name = 'Ada' RETURNING id`).Scan(&a)
	for _, id := range []string{"ntf-soon", "ntf-later"} {
		p.Exec(ctx, `INSERT INTO holds (showtime_id, seats, viewer_ref, status, expires_at, account_id) VALUES ($1, 1, 'r', 'paid', now(), $2)`, id, a)
	}
	now := time.Now()

	if err := s.Add(ctx, a, notify.New{Kind: "payment", Title: "Payment received", Dedupe: "pay:1"}); err != nil {
		t.Fatal(err)
	}
	s.Add(ctx, a, notify.New{Kind: "payment", Title: "Payment received", Dedupe: "pay:1"})
	s.AddByEmail(ctx, "NTF-A@example.com", notify.New{Kind: "party", Title: "Ben invited you to a watch party", Link: "/p/abc"})
	if err := s.Add(ctx, a, notify.New{Kind: "party", Title: "x", Link: "https://evil.example"}); err == nil {
		t.Fatal("external link accepted")
	}

	all, err := s.List(ctx, a, "", now)
	if err != nil || len(all) != 3 {
		t.Fatalf("all = %+v, %v", all, err)
	}
	var rem *notify.Note
	for i := range all {
		if all[i].Kind == "premiere" {
			rem = &all[i]
		}
	}
	if rem == nil || rem.Title != "Soon Film starts in 1 hour" || rem.Link != "/room/ntf-soon" || rem.Body != "Your room opens 30 minutes before the start. Your seat is ready." {
		t.Fatalf("reminder = %+v", rem)
	}
	s.List(ctx, a, "", now) // no duplicate reminder
	if n, _ := s.Unread(ctx, a, now); n != 3 {
		t.Fatalf("unread = %d", n)
	}
	pay, _ := s.List(ctx, a, "payments", now)
	if len(pay) != 1 || pay[0].Kind != "payment" {
		t.Fatalf("payments = %+v", pay)
	}
	if _, err := s.List(ctx, a, "nope", now); err != notify.ErrBadInput {
		t.Fatalf("bad category: %v", err)
	}
	s.MarkRead(ctx, a, pay[0].ID)
	if n, _ := s.Unread(ctx, a, now); n != 2 {
		t.Fatalf("unread after one = %d", n)
	}
	p.Exec(ctx, `UPDATE holds SET paypal_order_id = 'NTF-ORDER', paypal_capture_id = 'NTF-CAP' WHERE showtime_id = 'ntf-later'`)
	s.Captured(ctx, "NTF-ORDER")
	s.Captured(ctx, "NTF-ORDER")
	s.Refunded(ctx, "NTF-CAP")
	pay, _ = s.List(ctx, a, "payments", now)
	if len(pay) != 3 || pay[0].Kind != "refund" || pay[1].Title != "Payment received for Later Film" {
		t.Fatalf("payments after capture = %+v", pay)
	}
	s.MarkRead(ctx, a, 0)
	if n, _ := s.Unread(ctx, a, now); n != 0 {
		t.Fatalf("unread after all = %d", n)
	}
}
