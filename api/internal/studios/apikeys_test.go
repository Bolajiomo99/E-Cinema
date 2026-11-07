package studios_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/studios"
)

func TestAPIKeys(t *testing.T) {
	p := pool(t)
	ctx := context.Background()
	st := studios.Store{DB: p}
	const name = "Test Key Pictures"
	clean := func() {
		p.Exec(ctx, `DELETE FROM holds WHERE viewer_ref LIKE 'ak-%'`)
		p.Exec(ctx, `DELETE FROM studios WHERE name = $1`, name)
		p.Exec(ctx, `DELETE FROM showtimes WHERE studio IN ($1, 'Other Key Studio')`, name)
	}
	clean()
	t.Cleanup(clean)
	owner := account(t, p, "ak-owner@example.com", "Ada Obi", "NG")
	fin := account(t, p, "ak-fin@example.com", "Femi Ade", "NG")
	buyer := account(t, p, "ak-buyer@example.com", "Kemi Lawal", "GH")
	p.Exec(ctx, `INSERT INTO studios (name, slug, status, payout_email, verified_at, rights_at) VALUES ($1, 'test-key-pictures', 'verified', 'x@example.com', now(), now())`, name)
	p.Exec(ctx, `INSERT INTO studio_members (studio, email, account_id, role) VALUES ($1, 'ak-owner@example.com', $2, 'owner'), ($1, 'ak-fin@example.com', $3, 'finance')`, name, owner, fin)
	p.Exec(ctx, `INSERT INTO showtimes (id, film, studio, starts_at, duration_min, capacity, price_cents, currency) VALUES
	  ('test-ak-1', 'Copper Tide', $1, now() + interval '3 days', 100, 40, 500, 'USD'), ('test-ak-x', 'Not Yours', 'Other Key Studio', now(), 90, 10, 500, 'USD')`, name)
	p.Exec(ctx, `INSERT INTO holds (showtime_id, seats, viewer_ref, status, expires_at, account_id, paid_at, net_cents) VALUES ('test-ak-1', 3, 'ak-1', 'paid', now(), $1, now(), 1500)`, buyer)

	if _, err := st.AddKey(ctx, fin, "ak-fin@example.com", "ERP"); !errors.Is(err, studios.ErrForbidden) {
		t.Fatalf("finance made a key: %v", err)
	}
	if _, err := st.AddKey(ctx, owner, "ak-owner@example.com", "  "); !errors.Is(err, studios.ErrBadInput) {
		t.Fatalf("empty name: %v", err)
	}
	k, err := st.AddKey(ctx, owner, "ak-owner@example.com", "Finance ERP")
	if err != nil || !strings.HasPrefix(k.Key, "ecs_") || len(k.Key) != 44 || k.Prefix != k.Key[:10] {
		t.Fatalf("add: %+v %v", k, err)
	}
	if l, _ := st.Keys(ctx, owner, "ak-owner@example.com"); len(l) != 1 || l[0].Key != "" {
		t.Fatalf("list: %+v", l)
	}
	now := time.Now()
	films, err := st.APIFilms(ctx, k.Key, now)
	if err != nil || len(films) != 1 || films[0].Seats != 3 || films[0].GrossCents != 1500 {
		t.Fatalf("films: %+v %v", films, err)
	}
	sales, err := st.APISales(ctx, k.Key, "test-ak-1", now)
	if err != nil || sales.Seats != 3 || len(sales.Days) != 14 || sales.Countries[0].Country != "GH" {
		t.Fatalf("sales: %+v %v", sales, err)
	}
	if _, err := st.APISales(ctx, k.Key, "test-ak-x", now); !errors.Is(err, studios.ErrNoFilm) {
		t.Fatalf("another studio's film: %v", err)
	}
	if p, err := st.APIPayouts(ctx, k.Key, now); err != nil || p == nil {
		t.Fatalf("payouts: %v %v", p, err)
	}
	if l, _ := st.Keys(ctx, owner, "ak-owner@example.com"); l[0].LastUsedAt == nil {
		t.Fatal("last used not recorded")
	}
	for _, bad := range []string{"", "ecs_nothex", "ecs_" + strings.Repeat("0", 40)} {
		if _, err := st.APIFilms(ctx, bad, now); !errors.Is(err, studios.ErrBadKey) {
			t.Fatalf("%q: %v", bad, err)
		}
	}
	if err := st.RevokeKey(ctx, owner, "ak-owner@example.com", k.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := st.APIFilms(ctx, k.Key, now); !errors.Is(err, studios.ErrBadKey) {
		t.Fatalf("revoked key still works: %v", err)
	}
	for i := 0; i < studios.MaxKeys; i++ {
		if _, err := st.AddKey(ctx, owner, "ak-owner@example.com", "k"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := st.AddKey(ctx, owner, "ak-owner@example.com", "one more"); !errors.Is(err, studios.ErrTooManyKeys) {
		t.Fatalf("over the cap: %v", err)
	}
}
