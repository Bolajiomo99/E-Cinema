package library_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/db"
	"github.com/Bolajiomo99/E-Cinema/api/internal/library"
)

func TestLibrary(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	p, err := db.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	if err := db.Migrate(ctx, p); err != nil {
		t.Fatal(err)
	}
	s := library.Store{DB: p}
	for _, q := range []string{
		`DELETE FROM library_keeps WHERE showtime_id LIKE 'lib-%'`,
		`DELETE FROM collections WHERE account_id IN (SELECT id FROM accounts WHERE email LIKE 'lib-%@example.com')`,
		`DELETE FROM holds WHERE showtime_id LIKE 'lib-%'`,
		`DELETE FROM classic_votes WHERE classic_id = 'lib-classic-1990'`,
		`DELETE FROM classics WHERE id = 'lib-classic-1990'`,
	} {
		if _, err := p.Exec(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	// lib-old ended 40 days ago, lib-recent ended 5 days ago, lib-future has not started.
	p.Exec(ctx, `INSERT INTO showtimes VALUES ('lib-old', 'Old Film', 'S', now() - interval '40 days', 90, 10, 500, 'USD'),
	  ('lib-recent', 'Recent Film', 'S', now() - interval '5 days', 90, 10, 500, 'USD'),
	  ('lib-future', 'Future Film', 'S', now() + interval '5 days', 90, 10, 500, 'USD') ON CONFLICT (id) DO UPDATE SET starts_at = EXCLUDED.starts_at`)
	var a, b string
	p.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash, country) VALUES ('lib-a@example.com', 'Ada', 'x', 'NG') ON CONFLICT (email) DO UPDATE SET country = 'NG' RETURNING id`).Scan(&a)
	p.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash) VALUES ('lib-b@example.com', 'Ben', 'x') ON CONFLICT (email) DO UPDATE SET name = 'Ben' RETURNING id`).Scan(&b)
	for _, id := range []string{"lib-old", "lib-recent", "lib-future"} {
		p.Exec(ctx, `INSERT INTO holds (showtime_id, seats, viewer_ref, status, expires_at, account_id, quality) VALUES ($1, 1, 'r', 'paid', now(), $2, '4k')`, id, a)
	}
	now := time.Now()

	items, err := s.Items(ctx, a, now)
	if err != nil || len(items) != 1 || items[0].ShowtimeID != "lib-recent" || items[0].Owned || items[0].Quality != "4k" || items[0].ExpiresAt == nil {
		t.Fatalf("items = %+v, %v", items, err)
	}
	if days := time.Until(*items[0].ExpiresAt).Hours() / 24; days < 24 || days > 26 {
		t.Fatalf("replay window left = %.1f days", days)
	}
	if _, err := s.Access(ctx, a, "lib-old", now); !errors.Is(err, library.ErrReplayGone) {
		t.Fatalf("old access: %v", err)
	}
	if _, err := s.Access(ctx, b, "lib-recent", now); !errors.Is(err, library.ErrNotFound) {
		t.Fatalf("stranger access: %v", err)
	}

	// Keeping a film: only after it ends, only with a seat, once.
	if err := s.AttachKeep(ctx, a, "lib-future", "hd", "LIB-O1", 998, "USD"); !errors.Is(err, library.ErrNotEnded) {
		t.Fatalf("keep before end: %v", err)
	}
	if err := s.AttachKeep(ctx, b, "lib-old", "hd", "LIB-O2", 998, "USD"); !errors.Is(err, library.ErrNoSeat) {
		t.Fatalf("keep without seat: %v", err)
	}
	if err := s.AttachKeep(ctx, a, "lib-old", "4k", "LIB-O3", 998, "USD"); err != nil {
		t.Fatal(err)
	}
	if err := s.AttachKeep(ctx, a, "lib-old", "4k", "LIB-O4", 998, "USD"); err != nil {
		t.Fatalf("retry replaces pending: %v", err)
	}
	if ok, err := s.MarkKeepPaid(ctx, "LIB-O3", "LIB-C3"); err != nil || ok {
		t.Fatalf("stale order paid: %v %v", ok, err)
	}
	if ok, err := s.MarkKeepPaid(ctx, "LIB-O4", "LIB-C4"); err != nil || !ok {
		t.Fatalf("mark paid: %v %v", ok, err)
	}
	if ok, err := s.MarkKeepPaid(ctx, "LIB-O4", "LIB-C4"); err != nil || !ok {
		t.Fatalf("mark paid again: %v %v", ok, err)
	}
	if ok, _ := s.MarkKeepPaid(ctx, "NOT-A-KEEP", "X"); ok {
		t.Fatal("unknown order counted as keep")
	}
	if err := s.AttachKeep(ctx, a, "lib-old", "4k", "LIB-O5", 998, "USD"); !errors.Is(err, library.ErrOwned) {
		t.Fatalf("keep twice: %v", err)
	}
	items, _ = s.Items(ctx, a, now)
	if len(items) != 2 || items[0].ShowtimeID != "lib-old" || !items[0].Owned || items[0].ExpiresAt != nil {
		t.Fatalf("after keep = %+v", items)
	}

	// Collections.
	c, err := s.CreateCollection(ctx, a, "  Nollywood   nights ", false)
	if err != nil || c.Name != "Nollywood nights" {
		t.Fatalf("create = %+v %v", c, err)
	}
	if _, err := s.CreateCollection(ctx, a, "", false); !errors.Is(err, library.ErrBadInput) {
		t.Fatalf("empty name: %v", err)
	}
	if err := s.SetFilm(ctx, a, c.ID, "lib-recent", true); err != nil {
		t.Fatal(err)
	}
	s.SetFilm(ctx, a, c.ID, "lib-old", true)
	s.SetFilm(ctx, a, c.ID, "no-such-film", true)
	if err := s.SetFilm(ctx, b, c.ID, "lib-old", false); !errors.Is(err, library.ErrNotOwner) {
		t.Fatalf("stranger edit: %v", err)
	}
	if err := s.SetFilm(ctx, a, "not-a-uuid", "lib-old", true); !errors.Is(err, library.ErrNotFound) {
		t.Fatalf("bad id: %v", err)
	}
	if _, err := s.Share(ctx, a, c.ID, "LIB-A@example.com"); !errors.Is(err, library.ErrShareSelf) {
		t.Fatalf("share self: %v", err)
	}
	if _, err := s.Share(ctx, a, c.ID, "nobody@example.com"); !errors.Is(err, library.ErrNoFriend) {
		t.Fatalf("share unknown: %v", err)
	}
	if name, err := s.Share(ctx, a, c.ID, "lib-b@example.com"); err != nil || name != "Ben" {
		t.Fatalf("share = %q %v", name, err)
	}
	mine, _ := s.Collections(ctx, a)
	theirs, _ := s.Collections(ctx, b)
	if len(mine) != 1 || len(mine[0].Films) != 2 || len(mine[0].SharedTo) != 1 || !mine[0].Mine {
		t.Fatalf("mine = %+v", mine)
	}
	if len(theirs) != 1 || theirs[0].Mine || theirs[0].Owner != "Ada" || len(theirs[0].SharedTo) != 0 {
		t.Fatalf("theirs = %+v", theirs)
	}
	if err := s.Leave(ctx, b, c.ID); err != nil {
		t.Fatal(err)
	}
	if theirs, _ = s.Collections(ctx, b); len(theirs) != 0 {
		t.Fatal("left collection still shown")
	}
	if err := s.UpdateCollection(ctx, a, c.ID, "Family Sundays", true); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteCollection(ctx, a, c.ID); err != nil {
		t.Fatal(err)
	}

	// Requested classics and where they stand.
	p.Exec(ctx, `INSERT INTO classics (id, title, year, goal, blocked_countries) VALUES ('lib-classic-1990', 'Lib Classic', 1990, 1, '{NG}')`)
	p.Exec(ctx, `INSERT INTO classic_votes (classic_id, account_id) VALUES ('lib-classic-1990', $1), ('lib-classic-1990', $2)`, a, b)
	ra, _ := s.Requested(ctx, a)
	rb, _ := s.Requested(ctx, b)
	if len(ra) == 0 || ra[0].Status != "blocked" || ra[0].Votes != 2 {
		t.Fatalf("requested a = %+v", ra)
	}
	if len(rb) == 0 || rb[0].Status != "talks" {
		t.Fatalf("requested b = %+v", rb)
	}
	p.Exec(ctx, `UPDATE classics SET showtime_id = 'lib-future' WHERE id = 'lib-classic-1990'`)
	if rb, _ = s.Requested(ctx, b); rb[0].Status != "yes" || rb[0].StartsAt == nil {
		t.Fatalf("scheduled = %+v", rb)
	}
}
