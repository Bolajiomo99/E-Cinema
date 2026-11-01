package studios_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/studios"
)

func TestPremieres(t *testing.T) {
	p := pool(t)
	ctx := context.Background()
	st := studios.Store{DB: p}
	const name, email = "Test Premiere Pictures", "pr-owner@example.com"
	clean := func() {
		p.Exec(ctx, `DELETE FROM holds WHERE showtime_id IN (SELECT id FROM showtimes WHERE studio = $1)`, name)
		p.Exec(ctx, `DELETE FROM studios WHERE name = $1`, name)
		p.Exec(ctx, `DELETE FROM showtimes WHERE studio = $1`, name)
	}
	clean()
	t.Cleanup(clean)
	owner := account(t, p, email, "Ada Obi", "NG")
	viewer := account(t, p, "pr-viewer@example.com", "Ife Ola", "DE")
	p.Exec(ctx, `INSERT INTO studios (name, slug, status, payout_email, verified_at) VALUES ($1, 'test-premiere-pictures', 'verified', 'x@example.com', now())`, name)
	p.Exec(ctx, `INSERT INTO studio_members (studio, email, account_id, role) VALUES ($1, $2, $3, 'owner'), ($1, 'pr-viewer@example.com', $4, 'viewer')`, name, email, owner, viewer)
	u, err := st.CreateUpload(ctx, owner, email, "Blade of Kumo")
	if err != nil {
		t.Fatal(err)
	}

	got, err := st.Premiere(ctx, owner, email, u.ID)
	if err != nil || got.Mode != "global" || got.Seats != 5000 || got.ShowtimeID != nil || len(got.Prices) != 0 {
		t.Fatalf("defaults: %+v %v", got, err)
	}
	now := time.Now()
	starts := now.Add(72 * time.Hour)
	in := studios.PremiereInput{Mode: "global", StartsAt: starts, Seats: 50000, Encores: 2, PriceCents: 699, FreePlan: true, DurationMin: 124,
		Prices: []studios.Price{{Country: "ng", Currency: "ngn", AmountMinor: 320000, Note: "Looks right"}, {Country: "DE", Currency: "EUR", AmountMinor: 699}}}
	if _, err := st.SavePremiere(ctx, viewer, "pr-viewer@example.com", u.ID, in, now); !errors.Is(err, studios.ErrForbidden) {
		t.Fatalf("viewer saves: %v", err)
	}
	bad := in
	bad.Prices = []studios.Price{{Country: "NG", Currency: "NGN", AmountMinor: 1}, {Country: "NG", Currency: "NGN", AmountMinor: 2}}
	if _, err := st.SavePremiere(ctx, owner, email, u.ID, bad, now); !errors.Is(err, studios.ErrBadInput) {
		t.Fatalf("duplicate country: %v", err)
	}
	saved, err := st.SavePremiere(ctx, owner, email, u.ID, in, now)
	if err != nil || saved.Seats != 50000 || len(saved.Prices) != 2 || saved.Prices[1].Country != "NG" || saved.Prices[1].Currency != "NGN" || saved.PublishedAt != nil {
		t.Fatalf("save: %+v %v", saved, err)
	}

	// Publishing needs a master, declared rights, a single global time and a future start.
	in.Publish = true
	if _, err := st.SavePremiere(ctx, owner, email, u.ID, in, now); err == nil || !strings.Contains(err.Error(), "picture master") {
		t.Fatalf("no master: %v", err)
	}
	m, _ := st.AddFile(ctx, owner, email, u.ID, "Kumo_MASTER.mov", 1000)
	done := "uploaded"
	st.UpdateFile(ctx, owner, email, u.ID, m.ID, studios.FileUpdate{Status: &done})
	if _, err := st.SavePremiere(ctx, owner, email, u.ID, in, now); err == nil || !strings.Contains(err.Error(), "rights") {
		t.Fatalf("no rights: %v", err)
	}
	p.Exec(ctx, `UPDATE studios SET rights_at = now() WHERE name = $1`, name)
	rolling := in
	rolling.Mode = "rolling"
	if _, err := st.SavePremiere(ctx, owner, email, u.ID, rolling, now); err == nil || !strings.Contains(err.Error(), "soon") {
		t.Fatalf("rolling: %v", err)
	}
	soon := in
	soon.StartsAt = now.Add(10 * time.Minute)
	if _, err := st.SavePremiere(ctx, owner, email, u.ID, soon, now); !errors.Is(err, studios.ErrBadInput) {
		t.Fatalf("too soon: %v", err)
	}
	pub, err := st.SavePremiere(ctx, owner, email, u.ID, in, now)
	if err != nil || pub.ShowtimeID == nil || pub.PublishedAt == nil {
		t.Fatalf("publish: %+v %v", pub, err)
	}
	sid := *pub.ShowtimeID
	if sid != "blade-of-kumo-"+starts.UTC().Format("2006-01-02") {
		t.Fatalf("showtime id %q", sid)
	}
	var film, studio string
	var capacity, price int
	p.QueryRow(ctx, `SELECT film, studio, capacity, price_cents FROM showtimes WHERE id = $1`, sid).Scan(&film, &studio, &capacity, &price)
	if film != "Blade of Kumo" || studio != name || capacity != 50000 || price != 699 {
		t.Fatalf("showtime row: %s %s %d %d", film, studio, capacity, price)
	}
	live, err := st.LiveFilms(ctx)
	found := false
	for _, f := range live {
		if f.ShowtimeID == sid {
			found = f.Prices["NG"].AmountMinor == 320000 && f.DurationMin == 124
		}
	}
	if err != nil || !found {
		t.Fatalf("live films: %v %+v", err, live)
	}

	// Sold seats are counted by the buyer's country, and lock the start time.
	p.Exec(ctx, `INSERT INTO holds (showtime_id, seats, viewer_ref, status, expires_at, account_id) VALUES ($1, 2, 'pr-test', 'paid', now(), $2)`, sid, viewer)
	again, _ := st.Premiere(ctx, owner, email, u.ID)
	if again.Sold != 2 || again.Prices[0].Country != "DE" || again.Prices[0].Sold != 2 {
		t.Fatalf("sold: %+v", again)
	}
	moved := in
	moved.StartsAt = starts.Add(time.Hour)
	if _, err := st.SavePremiere(ctx, owner, email, u.ID, moved, now); err == nil || !strings.Contains(err.Error(), "Reschedule") {
		t.Fatalf("move with tickets: %v", err)
	}
	less := in
	less.Seats = 10
	if _, err := st.SavePremiere(ctx, owner, email, u.ID, less, now); err != nil {
		t.Fatalf("fewer seats than capacity but more than sold: %v", err)
	}
	in.PriceCents = 799
	if up, err := st.SavePremiere(ctx, owner, email, u.ID, in, now); err != nil || *up.ShowtimeID != sid {
		t.Fatalf("republish: %+v %v", up, err)
	}
	p.QueryRow(ctx, `SELECT price_cents FROM showtimes WHERE id = $1`, sid).Scan(&price)
	if price != 799 {
		t.Fatalf("price not updated: %d", price)
	}
	// Renaming the film renames the listing; a published film cannot be deleted.
	if _, err := st.SaveDetails(ctx, owner, email, u.ID, studios.Details{Title: "Blade of Kumo II", AgeRating: "18+"}); err != nil {
		t.Fatal(err)
	}
	var adult bool
	p.QueryRow(ctx, `SELECT film, adult FROM showtimes WHERE id = $1`, sid).Scan(&film, &adult)
	if film != "Blade of Kumo II" || !adult {
		t.Fatalf("details not carried: %s %v", film, adult)
	}
	if err := st.DeleteUpload(ctx, owner, email, u.ID); !errors.Is(err, studios.ErrNotFound) {
		t.Fatalf("delete published: %v", err)
	}
}
