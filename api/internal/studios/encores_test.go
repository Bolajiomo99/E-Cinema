package studios_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/studios"
)

func TestSellOutEncores(t *testing.T) {
	p := pool(t)
	ctx := context.Background()
	st := studios.Store{DB: p}
	const name = "Test Encore Pictures"
	clean := func() {
		p.Exec(ctx, `DELETE FROM notifications WHERE dedupe LIKE 'encore:test-enc-%'`)
		p.Exec(ctx, `DELETE FROM holds WHERE viewer_ref LIKE 'enc-%'`)
		p.Exec(ctx, `DELETE FROM studios WHERE name = $1`, name)
		p.Exec(ctx, `DELETE FROM showtimes WHERE studio = $1 AND encore_of IS NOT NULL`, name)
		p.Exec(ctx, `DELETE FROM showtimes WHERE studio = $1`, name)
	}
	clean()
	t.Cleanup(clean)
	owner := account(t, p, "enc-owner@example.com", "Ada Obi", "NG")
	viewer := account(t, p, "enc-viewer@example.com", "Ife Ola", "NG")
	buyer := account(t, p, "enc-buyer@example.com", "Kemi Lawal", "GH")
	p.Exec(ctx, `INSERT INTO studios (name, slug, status, payout_email, verified_at, rights_at) VALUES ($1, 'test-encore-pictures', 'verified', 'x@example.com', now(), now())`, name)
	p.Exec(ctx, `INSERT INTO studio_members (studio, email, account_id, role) VALUES ($1, 'enc-owner@example.com', $2, 'owner'), ($1, 'enc-viewer@example.com', $3, 'viewer')`, name, owner, viewer)
	var up string
	p.QueryRow(ctx, `INSERT INTO studio_uploads (studio, title) VALUES ($1, 'Copper Tide') RETURNING id`, name).Scan(&up)
	start := time.Now().Add(3 * 24 * time.Hour).Truncate(time.Minute)
	p.Exec(ctx, `INSERT INTO showtimes (id, film, studio, starts_at, duration_min, capacity, price_cents, currency) VALUES ('test-enc-1', 'Copper Tide', $1, $2, 100, 3, 500, 'USD')`, name, start)
	p.Exec(ctx, `INSERT INTO studio_premieres (upload, showtime_id, published_at, encores) VALUES ($1, 'test-enc-1', now(), 2)`, up)

	now := time.Now()
	sell := func(show string, seats int, ref string) {
		if _, err := p.Exec(ctx, `INSERT INTO holds (showtime_id, seats, viewer_ref, status, expires_at, account_id, paid_at) VALUES ($1, $2, $3, 'paid', now(), $4, now())`, show, seats, ref, buyer); err != nil {
			t.Fatal(err)
		}
	}
	sell("test-enc-1", 2, "enc-a")
	if n, _ := st.ProposeEncores(ctx, now); n != 0 {
		t.Fatalf("proposed before sell-out: %d", n)
	}
	sell("test-enc-1", 1, "enc-b")
	if n, err := st.ProposeEncores(ctx, now); err != nil || n != 1 {
		t.Fatalf("proposed %d: %v", n, err)
	}
	if n, _ := st.ProposeEncores(ctx, now); n != 0 {
		t.Fatal("proposed twice")
	}
	var notes int
	p.QueryRow(ctx, `SELECT count(*) FROM notifications WHERE dedupe = 'encore:test-enc-1:1'`).Scan(&notes)
	if notes != 1 {
		t.Fatalf("owner notices: %d (the viewer gets none)", notes)
	}
	list, err := st.Encores(ctx, viewer, "enc-viewer@example.com", up)
	if err != nil || len(list) != 1 || list[0].Status != "proposed" || !list[0].StartsAt.Equal(start.Add(7*24*time.Hour)) {
		t.Fatalf("list: %+v %v", list, err)
	}
	if _, err := st.DecideEncore(ctx, viewer, "enc-viewer@example.com", up, 1, true, now); !errors.Is(err, studios.ErrForbidden) {
		t.Fatalf("viewer approved: %v", err)
	}
	e, err := st.DecideEncore(ctx, owner, "enc-owner@example.com", up, 1, true, now)
	if err != nil || e.ShowtimeID != "test-enc-1-encore-1" {
		t.Fatalf("approve: %+v %v", e, err)
	}
	if _, err := st.DecideEncore(ctx, owner, "enc-owner@example.com", up, 1, false, now); !errors.Is(err, studios.ErrNotFound) {
		t.Fatalf("decided twice: %v", err)
	}
	live, _ := st.LiveFilms(ctx)
	found := false
	for _, f := range live {
		if f.ShowtimeID == "test-enc-1-encore-1" {
			found = f.EncoreOf == "test-enc-1" && f.Upload == up
		}
	}
	if !found {
		t.Fatal("approved encore missing from the live catalog")
	}

	// The encore sells out too: the second (last allowed) is proposed, then declined.
	sell("test-enc-1-encore-1", 3, "enc-c")
	if n, _ := st.ProposeEncores(ctx, now); n != 1 {
		t.Fatalf("second encore proposed %d", n)
	}
	if e, err := st.DecideEncore(ctx, owner, "enc-owner@example.com", up, 2, false, now); err != nil || e.Status != "declined" || e.ShowtimeID != "" {
		t.Fatalf("decline: %+v %v", e, err)
	}
	if n, _ := st.ProposeEncores(ctx, now); n != 0 {
		t.Fatal("proposed past the limit or after a decline")
	}
	list, _ = st.Encores(ctx, owner, "enc-owner@example.com", up)
	if len(list) != 2 || list[0].Sold != 3 || list[0].Capacity != 3 || list[1].Status != "declined" {
		t.Fatalf("final list: %+v", list)
	}
}
