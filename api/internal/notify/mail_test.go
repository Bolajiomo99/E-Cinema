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

func TestMail(t *testing.T) {
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
	p.Exec(ctx, `DELETE FROM mail_outbox`)
	p.Exec(ctx, `DELETE FROM watch_beats WHERE showtime_id LIKE 'mail-%'`)
	p.Exec(ctx, `DELETE FROM holds WHERE showtime_id LIKE 'mail-%'`)
	p.Exec(ctx, `INSERT INTO showtimes VALUES
	  ('mail-soon', 'Soon Film', 'S', now() + interval '40 minutes', 90, 10, 500, 'NGN'),
	  ('mail-started', 'Started Film', 'S', now() - interval '6 minutes', 90, 10, 500, 'NGN'),
	  ('mail-far', 'Far Film', 'S', now() + interval '30 days', 90, 10, 500, 'NGN')
	  ON CONFLICT (id) DO UPDATE SET starts_at = EXCLUDED.starts_at, currency = EXCLUDED.currency`)
	var a, b string
	p.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash, country) VALUES ('mail-a@example.com', 'Ada', 'x', 'NG')
	  ON CONFLICT (email) DO UPDATE SET name = 'Ada', country = 'NG', delete_after = NULL RETURNING id`).Scan(&a)
	p.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash) VALUES ('mail-b@example.com', 'Ben', 'x')
	  ON CONFLICT (email) DO UPDATE SET name = 'Ben' RETURNING id`).Scan(&b)
	order := func(show, acct, id string) {
		p.Exec(ctx, `INSERT INTO holds (showtime_id, seats, viewer_ref, status, expires_at, account_id, paypal_order_id, net_cents)
		  VALUES ($1, 2, 'r', 'held', now() + interval '5 minutes', $2, $3, 1000)`, show, acct, id)
		p.Exec(ctx, `UPDATE holds SET status = 'paid', paid_at = now(), paypal_capture_id = $1 || '-c' WHERE paypal_order_id = $1`, id)
	}
	order("mail-soon", a, "mail-o1")
	order("mail-far", a, "mail-o2")
	order("mail-started", a, "mail-o3")
	order("mail-started", b, "mail-o4")
	p.Exec(ctx, `INSERT INTO watch_beats (account_id, showtime_id, day, mode, seconds) VALUES ($1, 'mail-started', current_date, 'room', 60)`, b)

	for _, o := range []string{"mail-o1", "mail-o2", "mail-o3", "mail-o1"} {
		if err := s.Captured(ctx, o); err != nil {
			t.Fatal(err)
		}
	}
	kinds := func() map[string]int {
		m := map[string]int{}
		rows, _ := p.Query(ctx, `SELECT kind FROM mail_outbox WHERE failed_at IS NULL`)
		for rows.Next() {
			var k string
			rows.Scan(&k)
			m[k]++
		}
		rows.Close()
		return m
	}
	if k := kinds(); k["ticket"] != 2 || k["preorder"] != 1 || len(k) != 2 {
		t.Fatalf("after capture = %v", k)
	}

	n, err := s.ScheduleMail(ctx, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	s.ScheduleMail(ctx, time.Now())
	if k := kinds(); n < 2 || k["reminder"] != 1 || k["not_joined"] != 1 {
		t.Fatalf("scheduled %d: %v", n, k)
	}

	if err := s.Refunded(ctx, "mail-o1-c"); err != nil {
		t.Fatal(err)
	}
	p.Exec(ctx, `UPDATE holds SET status = 'refunded' WHERE paypal_capture_id = 'mail-o1-c'`)
	s.Refunded(ctx, "mail-o1-c")
	if k := kinds(); k["refund"] != 1 {
		t.Fatalf("refund mail = %v", k)
	}

	if err := s.Queue(ctx, notify.Mail{Kind: "welcome", To: "Mail-A@example.com", Name: "Ada", Dedupe: "welcome:a", SendAfter: time.Now().Add(time.Hour)}); err != nil {
		t.Fatal(err)
	}
	due, err := s.DueMail(ctx, 100)
	if err != nil {
		t.Fatal(err)
	}
	var ticket *notify.Outgoing
	for i := range due {
		if due[i].Kind == "welcome" {
			t.Fatal("future email handed out")
		}
		if due[i].Kind == "preorder" {
			ticket = &due[i]
		}
	}
	if ticket == nil || ticket.Country != "NG" || ticket.To != "mail-a@example.com" {
		t.Fatalf("preorder = %+v", ticket)
	}
	var d map[string]any
	json.Unmarshal(ticket.Data, &d)
	if d["film"] != "Far Film" || d["netMinor"].(float64) != 1000 || d["currency"] != "NGN" || d["stage"].(float64) != 1 {
		t.Fatalf("data = %v", d)
	}
	if again, _ := s.DueMail(ctx, 100); len(again) != 0 {
		t.Fatalf("claimed mail handed out twice: %d", len(again))
	}
	s.MailDone(ctx, ticket.ID, "")
	s.MailDone(ctx, due[0].ID, "Email failed (500)")
	var sent, retry bool
	p.QueryRow(ctx, `SELECT sent_at IS NOT NULL FROM mail_outbox WHERE id = $1`, ticket.ID).Scan(&sent)
	p.QueryRow(ctx, `SELECT claimed_at IS NULL AND failed_at IS NULL AND send_after > now() FROM mail_outbox WHERE id = $1`, due[0].ID).Scan(&retry)
	if !sent || (due[0].ID != ticket.ID && !retry) {
		t.Fatalf("sent=%v retry=%v", sent, retry)
	}
	s.Cancel(ctx, "welcome:a")
	var cancelled bool
	p.QueryRow(ctx, `SELECT failed_at IS NOT NULL FROM mail_outbox WHERE dedupe = 'welcome:a'`).Scan(&cancelled)
	if !cancelled {
		t.Fatal("cancel did nothing")
	}
}
