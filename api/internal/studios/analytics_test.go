package studios_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/studios"
)

func TestAnalytics(t *testing.T) {
	p := pool(t)
	ctx := context.Background()
	st := studios.Store{DB: p}
	const name, email = "Test Analytics Films", "an-owner@example.com"
	clean := func() {
		p.Exec(ctx, `DELETE FROM watch_beats WHERE showtime_id LIKE 'test-an-%'`)
		p.Exec(ctx, `DELETE FROM reviews WHERE showtime_id LIKE 'test-an-%'`)
		p.Exec(ctx, `DELETE FROM rewatch_parties WHERE showtime_id LIKE 'test-an-%'`)
		p.Exec(ctx, `DELETE FROM holds WHERE showtime_id LIKE 'test-an-%'`)
		p.Exec(ctx, `DELETE FROM studios WHERE name = $1`, name)
		p.Exec(ctx, `DELETE FROM showtimes WHERE id LIKE 'test-an-%'`)
	}
	clean()
	t.Cleanup(clean)
	owner := account(t, p, email, "Ada Obi", "NG")
	a1 := account(t, p, "an-v1@example.com", "Ife Ola", "NG")
	a2 := account(t, p, "an-v2@example.com", "Jon Berg", "DE")
	stranger := account(t, p, "an-x@example.com", "No One", "GB")
	p.Exec(ctx, `UPDATE accounts SET birth_date = now() - interval '30 years', gender = 'female', plan = 'pro' WHERE id = $1`, a1)
	p.Exec(ctx, `INSERT INTO studios (name, slug, status, payout_email, verified_at) VALUES ($1, 'test-analytics-films', 'verified', 'x@example.com', now())`, name)
	p.Exec(ctx, `INSERT INTO studio_members (studio, email, account_id, role) VALUES ($1, $2, $3, 'owner')`, name, email, owner)
	p.Exec(ctx, `INSERT INTO showtimes (id, film, studio, starts_at, duration_min, capacity, price_cents, currency) VALUES ('test-an-1', 'Copper Tide', $1, now() - interval '3 days', 100, 10, 1000, 'USD')`, name)
	p.Exec(ctx, `INSERT INTO holds (showtime_id, seats, viewer_ref, status, expires_at, account_id, paypal_order_id) VALUES
	  ('test-an-1', 2, 'v', 'paid', now(), $1, 'AN-1'), ('test-an-1', 1, 'v', 'refunded', now(), $2, 'AN-2')`, a1, a2)
	p.Exec(ctx, `UPDATE holds SET refunded_at = now() WHERE paypal_order_id = 'AN-2'`)
	p.Exec(ctx, `INSERT INTO watch_beats (account_id, showtime_id, day, mode, audio, seconds) VALUES
	  ($1, 'test-an-1', current_date - 2, 'room', '', 6000), ($2, 'test-an-1', current_date - 2, 'room', 'ha', 3000),
	  ($2, 'test-an-1', current_date - 120, 'replay', '', 600)`, a1, a2)
	p.Exec(ctx, `INSERT INTO reviews (account_id, showtime_id, stars) VALUES ($1, 'test-an-1', 5), ($2, 'test-an-1', 2)`, a1, a2)

	if _, err := st.Analytics(ctx, stranger, "an-x@example.com", 90, time.Now()); !errors.Is(err, studios.ErrNotFound) {
		t.Fatalf("stranger: %v", err)
	}
	a, err := st.Analytics(ctx, owner, email, 90, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if a.Viewers != 2 || a.ViewersPrev != 1 || a.WatchHours != 2.5 || a.Completion != 0.75 {
		t.Fatalf("totals: %+v", a)
	}
	if a.NPS == nil || *a.NPS != 0 || a.Reviews != 2 {
		t.Fatalf("nps: %+v", a.NPS)
	}
	if len(a.Countries) != 2 || a.Countries[0].Country != "NG" && a.Countries[0].Country != "DE" {
		t.Fatalf("countries: %+v", a.Countries)
	}
	for _, c := range a.Countries {
		if c.Country == "NG" && c.GrossCents != 2000 {
			t.Fatalf("NG gross: %+v", c)
		}
	}
	m := a.Money
	if m.GrossCents != 3000 || m.RefundCents != 1000 || m.ShareCents != 1400 || m.PlatformCents != 600 || m.Buyers != 1 || a.Funnel.Seats != 2 {
		t.Fatalf("money: %+v %+v", m, a.Funnel)
	}
	if len(a.Audio) != 2 || len(a.Genders) == 0 || len(a.Plans) == 0 {
		t.Fatalf("groups: %+v %+v %+v", a.Audio, a.Genders, a.Plans)
	}
	ages := map[string]int{}
	for _, c := range a.Ages {
		ages[c.Key] = c.Seats
	}
	if ages["25-34"] != 1 {
		t.Fatalf("ages: %+v", a.Ages)
	}
	if len(a.Cohorts) == 0 {
		t.Fatalf("cohorts: %+v", a.Cohorts)
	}
	if b, _ := st.Analytics(ctx, owner, email, 12, time.Now()); b.Days != 90 {
		t.Fatalf("odd days: %d", b.Days)
	}
}
