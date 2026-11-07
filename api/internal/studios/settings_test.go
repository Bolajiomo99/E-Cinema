package studios_test

import (
	"context"
	"errors"
	"testing"

	"github.com/Bolajiomo99/E-Cinema/api/internal/studios"
	"github.com/Bolajiomo99/E-Cinema/api/internal/tickets"
)

func TestTerritories(t *testing.T) {
	p := pool(t)
	ctx := context.Background()
	st := studios.Store{DB: p}
	tk := tickets.Store{DB: p}
	const name = "Test Territory Pictures"
	clean := func() {
		p.Exec(ctx, `DELETE FROM studios WHERE name = $1`, name)
		p.Exec(ctx, `DELETE FROM showtimes WHERE studio = $1`, name)
	}
	clean()
	t.Cleanup(clean)
	owner := account(t, p, "tt-owner@example.com", "Ada Obi", "NG")
	cn := account(t, p, "tt-cn@example.com", "Li Wei", "CN")
	p.Exec(ctx, `INSERT INTO studios (name, slug, status, payout_email, verified_at, rights_at) VALUES ($1, 'test-territory-pictures', 'verified', 'x@example.com', now(), now())`, name)
	p.Exec(ctx, `INSERT INTO studio_members (studio, email, account_id, role) VALUES ($1, 'tt-owner@example.com', $2, 'owner')`, name, owner)
	p.Exec(ctx, `INSERT INTO showtimes (id, film, studio, starts_at, duration_min, capacity, price_cents, currency) VALUES ('test-tt-1', 'Copper Tide', $1, now() + interval '3 days', 100, 40, 500, 'USD')`, name)

	if _, err := st.SetTerritories(ctx, owner, "tt-owner@example.com", []string{"China"}); !errors.Is(err, studios.ErrBadInput) {
		t.Fatalf("bad code: %v", err)
	}
	s, err := st.SetTerritories(ctx, owner, "tt-owner@example.com", []string{"ru", "CN", "RU"})
	if err != nil || len(s.Blocked) != 2 || s.Blocked[0] != "CN" {
		t.Fatalf("set: %+v %v", s.Blocked, err)
	}
	if m, _ := st.Mine(ctx, owner, "tt-owner@example.com"); len(m.Blocked) != 2 {
		t.Fatalf("not stored: %+v", m.Blocked)
	}
	for _, c := range []struct {
		country, acct string
		want          bool
	}{{"NG", "", false}, {"ru", "", true}, {"GB", cn, true}, {"", owner, false}} {
		if got, err := tk.Blocked(ctx, "test-tt-1", c.country, c.acct); err != nil || got != c.want {
			t.Fatalf("%+v: got %v %v", c, got, err)
		}
	}
	if s, _ = st.SetTerritories(ctx, owner, "tt-owner@example.com", nil); len(s.Blocked) != 0 {
		t.Fatal("not cleared")
	}
	if got, _ := tk.Blocked(ctx, "test-tt-1", "CN", cn); got {
		t.Fatal("still blocked after clearing")
	}
}
