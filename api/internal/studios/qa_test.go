package studios_test

import (
	"context"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/studios"
)

func TestFilmCode(t *testing.T) {
	if got := studios.FilmCode("Orbit Zero", "0000089f-0000-0000-0000-000000000000"); got != "FLM-OZ-2207" {
		t.Fatalf("code = %s", got)
	}
	if got := studios.FilmCode("Ìyá", "00000001-0000"); got != "FLM-Ì-0001" {
		t.Fatalf("one word = %s", got)
	}
}

func TestFilmChangesMail(t *testing.T) {
	p := pool(t)
	ctx := context.Background()
	st := studios.Store{DB: p}
	const name, email = "Test QA Pictures", "qa-owner@example.com"
	clean := func() {
		p.Exec(ctx, `DELETE FROM mail_outbox WHERE to_email LIKE 'qa-%'`)
		p.Exec(ctx, `DELETE FROM studios WHERE name = $1`, name)
		p.Exec(ctx, `DELETE FROM showtimes WHERE studio = $1`, name)
	}
	clean()
	t.Cleanup(clean)
	owner := account(t, p, email, "Ada Obi", "NG")
	p.Exec(ctx, `INSERT INTO studios (name, slug, status, payout_email, verified_at, rights_at) VALUES ($1, 'test-qa-pictures', 'verified', 'x@example.com', now(), now())`, name)
	p.Exec(ctx, `INSERT INTO studio_members (studio, email, account_id, role) VALUES ($1, $2, $3, 'owner')`, name, email, owner)
	u, _ := st.CreateUpload(ctx, owner, email, "Orbit Zero")
	m, _ := st.AddFile(ctx, owner, email, u.ID, "OZ_MASTER.mov", 1000)
	done := "uploaded"
	warn := []studios.Check{{State: "ok", Text: "4K picture"}, {State: "warn", Text: "Hausa dub drifts 0.4 seconds out of sync after 1:12:00."}}
	st.UpdateFile(ctx, owner, email, u.ID, m.ID, studios.FileUpdate{Status: &done, Checks: &warn})
	now := time.Now()
	if _, err := st.SavePremiere(ctx, owner, email, u.ID, studios.PremiereInput{Mode: "global", StartsAt: now.Add(72 * time.Hour), Seats: 500, PriceCents: 500, DurationMin: 100, Publish: true}, now); err != nil {
		t.Fatal(err)
	}
	count := func() (n int) {
		p.QueryRow(ctx, `SELECT count(*) FROM mail_outbox WHERE kind = 'film_changes' AND to_email = $1`, email).Scan(&n)
		return
	}
	if _, err := st.QueueFilmChanges(ctx, now); err != nil {
		t.Fatal(err)
	}
	var issues int
	p.QueryRow(ctx, `SELECT jsonb_array_length(data->'issues') FROM mail_outbox WHERE kind = 'film_changes' AND to_email = $1`, email).Scan(&issues)
	if count() != 1 || issues != 2 {
		t.Fatalf("first run: %d mails, %d issues", count(), issues)
	}
	st.QueueFilmChanges(ctx, now)
	if count() != 1 {
		t.Fatalf("same problems sent twice: %d", count())
	}
	// Fixing the age rating changes the list, so one new email.
	if _, err := st.SaveDetails(ctx, owner, email, u.ID, studios.Details{Title: "Orbit Zero", AgeRating: "13+"}); err != nil {
		t.Fatal(err)
	}
	st.QueueFilmChanges(ctx, now)
	if count() != 2 {
		t.Fatalf("after a change: %d", count())
	}
	ok := []studios.Check{{State: "ok", Text: "4K picture"}}
	st.UpdateFile(ctx, owner, email, u.ID, m.ID, studios.FileUpdate{Checks: &ok})
	st.QueueFilmChanges(ctx, now)
	if count() != 2 {
		t.Fatalf("nothing left to fix still mails: %d", count())
	}
}
