package studios_test

import (
	"context"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/studios"
)

func TestNotices(t *testing.T) {
	p := pool(t)
	ctx := context.Background()
	st := studios.Store{DB: p}
	const name, email = "Test Notice Pictures", "nt-owner@example.com"
	clean := func() {
		p.Exec(ctx, `DELETE FROM studio_leaks WHERE studio = $1`, name)
		p.Exec(ctx, `DELETE FROM reviews WHERE showtime_id = 'test-nt-1'`)
		p.Exec(ctx, `DELETE FROM studio_payouts WHERE studio = $1`, name)
		p.Exec(ctx, `DELETE FROM studios WHERE name = $1`, name)
		p.Exec(ctx, `DELETE FROM showtimes WHERE id = 'test-nt-1'`)
	}
	clean()
	t.Cleanup(clean)
	owner := account(t, p, email, "Ada Obi", "NG")
	viewer := account(t, p, "nt-viewer@example.com", "Ife Ola", "NG")
	p.Exec(ctx, `INSERT INTO studios (name, slug, status, payout_email, verified_at) VALUES ($1, 'test-notice-pictures', 'verified', 'x@example.com', now())`, name)
	p.Exec(ctx, `INSERT INTO studio_members (studio, email, account_id, role) VALUES ($1, $2, $3, 'owner'), ($1, 'nt-viewer@example.com', $4, 'viewer')`, name, email, owner, viewer)
	p.Exec(ctx, `INSERT INTO showtimes (id, film, studio, starts_at, duration_min, capacity, price_cents, currency) VALUES ('test-nt-1', 'Orbit Zero', $1, now() - interval '2 days', 100, 10, 700, 'USD')`, name)
	p.Exec(ctx, `INSERT INTO studio_leaks (studio, showtime_id, kind, place, link, reported_by) VALUES ($1, 'test-nt-1', 'clip', 'telegram', 'https://t.me/x/1', $2)`, name, owner)
	p.Exec(ctx, `INSERT INTO studio_payouts (showtime_id, studio, paid_seats, gross_cents, studio_cents, currency, status) VALUES ('test-nt-1', $1, 3, 2100, 1470, 'USD', 'sent')`, name)
	p.Exec(ctx, `INSERT INTO reviews (account_id, showtime_id, stars, body) VALUES ($1, 'test-nt-1', 5, 'Loved it')`, viewer)

	n, err := st.Notices(ctx, owner, email, time.Now())
	types := map[string]bool{}
	for _, x := range n.Notices {
		types[x.Type] = true
	}
	if err != nil || !types["leak_open"] || !types["payout_sent"] || !types["review"] || !types["member_added"] || n.Action != 1 || n.Unread != len(n.Notices) {
		t.Fatalf("owner: %+v %v", n, err)
	}
	// A viewer does not see money.
	v, err := st.Notices(ctx, viewer, "nt-viewer@example.com", time.Now())
	for _, x := range v.Notices {
		if x.Group == "money" {
			t.Fatal("viewer sees payouts")
		}
	}
	if err != nil || len(v.Notices) != len(n.Notices)-1 {
		t.Fatalf("viewer: %d %v", len(v.Notices), err)
	}
	if err := st.SeeNotices(ctx, owner, email, time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if n, _ = st.Notices(ctx, owner, email, time.Now()); n.Unread != 0 || n.SeenAt == nil {
		t.Fatalf("after seen: %+v", n)
	}
	if _, err := st.Notices(ctx, account(t, p, "nt-x@example.com", "X", "NG"), "nt-x@example.com", time.Now()); err == nil {
		t.Fatal("stranger reads notices")
	}
}
