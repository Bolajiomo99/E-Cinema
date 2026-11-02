package studios_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/studios"
)

func TestComingSoon(t *testing.T) {
	p := pool(t)
	ctx := context.Background()
	st := studios.Store{DB: p}
	const name, email = "Test Coming Pictures", "cs-owner@example.com"
	clean := func() {
		p.Exec(ctx, `DELETE FROM studios WHERE name = $1`, name)
		p.Exec(ctx, `DELETE FROM showtimes WHERE studio = $1`, name)
	}
	clean()
	t.Cleanup(clean)
	owner := account(t, p, email, "Ada Obi", "NG")
	viewer := account(t, p, "cs-viewer@example.com", "Ife Ola", "NG")
	p.Exec(ctx, `INSERT INTO studios (name, slug, status, payout_email, verified_at, rights_at) VALUES ($1, 'test-coming-pictures', 'verified', 'x@example.com', now(), now())`, name)
	p.Exec(ctx, `INSERT INTO studio_members (studio, email, account_id, role) VALUES ($1, $2, $3, 'owner'), ($1, 'cs-viewer@example.com', $4, 'viewer')`, name, email, owner, viewer)
	u, err := st.CreateUpload(ctx, owner, email, "Iron Delta")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	in := studios.PremiereInput{Mode: "global", StartsAt: now.Add(40 * 24 * time.Hour), Seats: 5000, PriceCents: 699, DurationMin: 120, Publish: true}
	// Without the coming-soon post, no master means no publishing.
	if _, err := st.SavePremiere(ctx, owner, email, u.ID, in, now); err == nil || !strings.Contains(err.Error(), "picture master") {
		t.Fatalf("plain publish: %v", err)
	}
	if _, err := st.SaveComingSoon(ctx, viewer, "cs-viewer@example.com", u.ID, studios.ComingSoonInput{EarlySave: 30, Formats: []string{"hd"}}); !errors.Is(err, studios.ErrForbidden) {
		t.Fatalf("viewer: %v", err)
	}
	for _, bad := range []studios.ComingSoonInput{{EarlySave: 70, Formats: []string{"hd"}}, {EarlySave: 30, Formats: []string{"8k"}}, {EarlySave: 30, Formats: []string{"vr"}}} {
		if _, err := st.SaveComingSoon(ctx, owner, email, u.ID, bad); !errors.Is(err, studios.ErrBadInput) {
			t.Fatalf("bad %+v: %v", bad, err)
		}
	}
	cs, err := st.SaveComingSoon(ctx, owner, email, u.ID, studios.ComingSoonInput{EarlySave: 38, Formats: []string{"hd", "uhd", "atmos", "vr", "hd"}})
	if err != nil || !cs.ComingSoon || cs.EarlySave != 38 || len(cs.Formats) != 4 || cs.PublishedAt != nil {
		t.Fatalf("save: %+v %v", cs, err)
	}
	// Too close to release without the master.
	near := in
	near.StartsAt = now.Add(3 * 24 * time.Hour)
	if _, err := st.SavePremiere(ctx, owner, email, u.ID, near, now); err == nil || !strings.Contains(err.Error(), "7 days") {
		t.Fatalf("near: %v", err)
	}
	pub, err := st.SavePremiere(ctx, owner, email, u.ID, in, now)
	if err != nil || pub.PublishedAt == nil || pub.ShowtimeID == nil || pub.EarlySave != 38 || !pub.ComingSoon {
		t.Fatalf("publish: %+v %v", pub, err)
	}
	live, err := st.LiveFilms(ctx)
	found := false
	for _, f := range live {
		if f.Upload == u.ID {
			found = f.EarlySave == 38 && len(f.Formats) == 4 && !f.HasMaster
		}
	}
	if err != nil || !found {
		t.Fatalf("live: %v %v", found, err)
	}
	// A plain save from the premieres page keeps the coming-soon settings.
	in.Publish = false
	if again, err := st.SavePremiere(ctx, owner, email, u.ID, in, now); err != nil || again.EarlySave != 38 || !again.ComingSoon {
		t.Fatalf("resave: %+v %v", again, err)
	}
}
