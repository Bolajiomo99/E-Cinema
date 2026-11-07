package studios_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/studios"
)

func TestPublicPage(t *testing.T) {
	p := pool(t)
	ctx := context.Background()
	st := studios.Store{DB: p}
	const name = "Test Page Pictures"
	clean := func() {
		p.Exec(ctx, `DELETE FROM notifications WHERE dedupe LIKE 'sfollow:test-pg-%'`)
		p.Exec(ctx, `DELETE FROM reviews WHERE showtime_id LIKE 'test-pg-%'`)
		p.Exec(ctx, `DELETE FROM studios WHERE name = $1`, name)
		p.Exec(ctx, `DELETE FROM showtimes WHERE studio = $1`, name)
	}
	clean()
	t.Cleanup(clean)
	owner := account(t, p, "pg-owner@example.com", "Ada Obi", "NG")
	fan := account(t, p, "pg-fan@example.com", "Kemi Lawal", "GH")
	p.Exec(ctx, `INSERT INTO studios (name, slug, status, city, payout_email, verified_at, rights_at) VALUES ($1, 'test-page-pictures', 'verified', 'Lagos', 'x@example.com', now(), now())`, name)
	p.Exec(ctx, `INSERT INTO studio_members (studio, email, account_id, role) VALUES ($1, 'pg-owner@example.com', $2, 'owner')`, name, owner)
	var past, coming string
	p.QueryRow(ctx, `INSERT INTO studio_uploads (studio, title) VALUES ($1, 'Copper Tide') RETURNING id`, name).Scan(&past)
	p.QueryRow(ctx, `INSERT INTO studio_uploads (studio, title) VALUES ($1, 'Iron Delta') RETURNING id`, name).Scan(&coming)
	p.Exec(ctx, `INSERT INTO showtimes (id, film, studio, starts_at, duration_min, capacity, price_cents, currency) VALUES
	  ('test-pg-1', 'Copper Tide', $1, now() - interval '10 days', 100, 40, 500, 'USD'), ('test-pg-2', 'Iron Delta', $1, now() + interval '5 days', 100, 40, 499, 'USD')`, name)
	p.Exec(ctx, `INSERT INTO studio_premieres (upload, showtime_id, published_at) VALUES ($1, 'test-pg-1', now() - interval '20 days'), ($2, 'test-pg-2', now() - interval '2 hours')`, past, coming)
	p.Exec(ctx, `INSERT INTO reviews (account_id, showtime_id, stars) VALUES ($1, 'test-pg-1', 4)`, fan)

	if _, err := st.PublicPage(ctx, "no-such-studio", "", time.Now()); !errors.Is(err, studios.ErrNotFound) {
		t.Fatalf("missing: %v", err)
	}
	if _, err := st.SetBio(ctx, owner, "pg-owner@example.com", "Stories from Lagos."); err != nil {
		t.Fatal(err)
	}
	pg, err := st.PublicPage(ctx, "test-page-pictures", "", time.Now())
	if err != nil || pg.Bio != "Stories from Lagos." || pg.Premieres != 2 || len(pg.Coming) != 1 || pg.Coming[0].Film != "Iron Delta" || len(pg.Past) != 1 || pg.Past[0].Reviews != 1 || pg.Following {
		t.Fatalf("page: %+v %v", pg, err)
	}
	if n, err := st.Follow(ctx, "test-page-pictures", fan, true); err != nil || n != 1 {
		t.Fatalf("follow: %d %v", n, err)
	}
	if n, _ := st.Follow(ctx, "test-page-pictures", fan, true); n != 1 {
		t.Fatal("followed twice")
	}
	if pg, _ = st.PublicPage(ctx, "test-page-pictures", fan, time.Now()); !pg.Following || pg.Followers != 1 {
		t.Fatalf("following: %+v", pg)
	}
	n, err := st.NotifyFollowers(ctx, time.Now())
	if err != nil || n != 1 {
		t.Fatalf("notify: %d %v", n, err)
	}
	if n, _ = st.NotifyFollowers(ctx, time.Now()); n != 0 {
		t.Fatal("notified twice")
	}
	if n, _ := st.Follow(ctx, "test-page-pictures", fan, false); n != 0 {
		t.Fatal("unfollow")
	}
}
