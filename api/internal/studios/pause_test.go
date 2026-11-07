package studios_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/studios"
)

func TestEmergencyPause(t *testing.T) {
	p := pool(t)
	ctx := context.Background()
	st := studios.Store{DB: p}
	const name = "Test Pause Pictures"
	clean := func() {
		p.Exec(ctx, `DELETE FROM studios WHERE name = $1`, name)
		p.Exec(ctx, `DELETE FROM showtimes WHERE studio = $1`, name)
	}
	clean()
	t.Cleanup(clean)
	owner := account(t, p, "ps-owner@example.com", "Ada Obi", "NG")
	viewer := account(t, p, "ps-viewer@example.com", "Ife Ola", "NG")
	p.Exec(ctx, `INSERT INTO studios (name, slug, status, payout_email, verified_at, rights_at) VALUES ($1, 'test-pause-pictures', 'verified', 'x@example.com', now(), now())`, name)
	p.Exec(ctx, `INSERT INTO studio_members (studio, email, account_id, role) VALUES ($1, 'ps-owner@example.com', $2, 'owner'), ($1, 'ps-viewer@example.com', $3, 'viewer')`, name, owner, viewer)
	var up string
	p.QueryRow(ctx, `INSERT INTO studio_uploads (studio, title) VALUES ($1, 'Copper Tide') RETURNING id`, name).Scan(&up)
	now := time.Now().Truncate(time.Second)
	p.Exec(ctx, `INSERT INTO showtimes (id, film, studio, starts_at, duration_min, capacity, price_cents, currency) VALUES ('test-ps-1', 'Copper Tide', $1, $2, 100, 40, 500, 'USD')`, name, now.Add(time.Hour))
	p.Exec(ctx, `INSERT INTO studio_premieres (upload, showtime_id, published_at) VALUES ($1, 'test-ps-1', now())`, up)

	if _, err := st.SetPause(ctx, owner, "ps-owner@example.com", up, true, now); !errors.Is(err, studios.ErrBadInput) {
		t.Fatalf("paused before the start: %v", err)
	}
	p.Exec(ctx, `UPDATE showtimes SET starts_at = $1 WHERE id = 'test-ps-1'`, now.Add(-10*time.Minute))
	if _, err := st.SetPause(ctx, viewer, "ps-viewer@example.com", up, true, now); !errors.Is(err, studios.ErrForbidden) {
		t.Fatalf("viewer paused: %v", err)
	}
	ps, err := st.SetPause(ctx, owner, "ps-owner@example.com", up, true, now)
	if err != nil || ps.PausedAt == nil {
		t.Fatalf("pause: %+v %v", ps, err)
	}
	if _, err := st.SetPause(ctx, owner, "ps-owner@example.com", up, true, now); !errors.Is(err, studios.ErrBadInput) {
		t.Fatalf("paused twice: %v", err)
	}
	ps, err = st.SetPause(ctx, owner, "ps-owner@example.com", up, false, now.Add(4*time.Minute+30*time.Second))
	if err != nil || ps.PausedAt != nil || ps.PausedMs != 270000 || ps.DurationMin != 105 {
		t.Fatalf("resume: %+v %v", ps, err)
	}
	if _, err := st.SetPause(ctx, owner, "ps-owner@example.com", up, false, now); !errors.Is(err, studios.ErrBadInput) {
		t.Fatalf("resumed twice: %v", err)
	}
}
