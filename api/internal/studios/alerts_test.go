package studios_test

import (
	"context"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/studios"
)

func TestMilestone(t *testing.T) {
	for _, c := range [][3]int{{0, 100, 0}, {24, 100, 0}, {25, 100, 25}, {49, 100, 25}, {50, 100, 50}, {99, 100, 50}, {100, 100, 100}, {5, 0, 0}} {
		if got := studios.Milestone(c[0], c[1]); got != c[2] {
			t.Fatalf("Milestone(%d, %d) = %d, want %d", c[0], c[1], got, c[2])
		}
	}
}

func TestStudioAlerts(t *testing.T) {
	p := pool(t)
	ctx := context.Background()
	st := studios.Store{DB: p}
	const name = "Test Alert Pictures"
	clean := func() {
		p.Exec(ctx, `DELETE FROM mail_outbox WHERE to_email LIKE 'al-%'`)
		p.Exec(ctx, `DELETE FROM holds WHERE viewer_ref LIKE 'al-%'`)
		p.Exec(ctx, `DELETE FROM studio_leaks WHERE studio = $1`, name)
		p.Exec(ctx, `DELETE FROM security_incidents WHERE showtime_id = 'test-al-1'`)
		p.Exec(ctx, `DELETE FROM studios WHERE name = $1`, name)
		p.Exec(ctx, `DELETE FROM showtimes WHERE studio = $1`, name)
	}
	clean()
	t.Cleanup(clean)
	owner := account(t, p, "al-owner@example.com", "Ada Obi", "NG")
	admin := account(t, p, "al-admin@example.com", "Tolu Ade", "NG")
	buyer := account(t, p, "al-buyer@example.com", "Kemi Lawal", "GH")
	p.Exec(ctx, `INSERT INTO studios (name, slug, status, payout_email, verified_at, rights_at) VALUES ($1, 'test-alert-pictures', 'verified', 'x@example.com', now(), now())`, name)
	p.Exec(ctx, `INSERT INTO studio_members (studio, email, account_id, role) VALUES ($1, 'al-owner@example.com', $2, 'owner'), ($1, 'al-admin@example.com', $3, 'admin')`, name, owner, admin)

	got, err := st.Alerts(ctx, admin, "al-admin@example.com")
	if err != nil || len(got) != 4 {
		t.Fatalf("default alerts = %v, %v", got, err)
	}
	if got, err = st.SetAlert(ctx, admin, "al-admin@example.com", "milestones", false); err != nil || len(got) != 3 {
		t.Fatalf("off = %v, %v", got, err)
	}
	if _, err := st.SetAlert(ctx, admin, "al-admin@example.com", "nonsense", true); err == nil {
		t.Fatal("unknown kind accepted")
	}

	// Monday 10:00 Lagos; the sales were last Wednesday.
	now := time.Date(2026, 11, 9, 9, 0, 0, 0, time.UTC)
	p.Exec(ctx, `INSERT INTO showtimes (id, film, studio, starts_at, duration_min, capacity, price_cents, currency) VALUES ('test-al-1', 'Copper Tide', $1, $2::timestamptz + interval '5 days', 100, 4, 500, 'USD')`, name, now)
	p.Exec(ctx, `INSERT INTO holds (showtime_id, seats, viewer_ref, status, expires_at, account_id, paid_at, net_cents) VALUES ('test-al-1', 2, 'al-1', 'paid', now(), $1, $2::timestamptz - interval '5 days', 1000)`, buyer, now)
	p.Exec(ctx, `INSERT INTO studio_leaks (studio, showtime_id, kind, place, link, reported_by, created_at) VALUES ($1, 'test-al-1', 'clip', 'tiktok', 'https://tiktok.com/x', $2, $3)`, name, owner, now)

	p.Exec(ctx, `INSERT INTO security_incidents (title, kind, severity, created_by, showtime_id, outage_from, outage_to, opened_at) VALUES
	  ('Stream dropped in Ghana', 'outage', 'high', 'cto@example.com', 'test-al-1', $1::timestamptz - interval '1 hour', $1::timestamptz - interval '48 minutes', $1),
	  ('Bot attack on checkout', 'attack', 'high', 'cto@example.com', 'test-al-1', NULL, NULL, $1)`, now)
	t.Cleanup(func() { p.Exec(ctx, `DELETE FROM security_incidents WHERE showtime_id = 'test-al-1'`) })
	n, err := st.QueueAlerts(ctx, now)
	if err != nil {
		t.Fatal(err)
	}
	rows, _ := p.Query(ctx, `SELECT kind || ' ' || to_email || ' ' || coalesce(data->>'pct', '') || coalesce(data->>'seats', '') || coalesce(data->>'minutes', '') FROM mail_outbox WHERE to_email LIKE 'al-%' ORDER BY 1`)
	var sent []string
	for rows.Next() {
		var s string
		rows.Scan(&s)
		sent = append(sent, s)
	}
	rows.Close()
	want := []string{
		"studio_incident al-admin@example.com 12",
		"studio_incident al-owner@example.com 12",
		"studio_leak al-admin@example.com ",
		"studio_milestone al-owner@example.com 50",
		"studio_weekly al-admin@example.com 2",
		"studio_weekly al-owner@example.com 2",
	}
	if n != len(want) || len(sent) != len(want) {
		t.Fatalf("queued %d: %v", n, sent)
	}
	for i := range want {
		if sent[i] != want[i] {
			t.Fatalf("mail %d = %q, want %q (all %v)", i, sent[i], want[i], sent)
		}
	}
	if n, _ := st.QueueAlerts(ctx, now.Add(time.Minute)); n != 0 {
		t.Fatalf("repeat queued %d", n)
	}
	// Sunday: no weekly report.
	p.Exec(ctx, `DELETE FROM mail_outbox WHERE to_email LIKE 'al-%' AND kind = 'studio_weekly'`)
	if n, _ := st.QueueAlerts(ctx, now.Add(-48*time.Hour)); n != 0 {
		t.Fatalf("sunday queued %d", n)
	}
}
