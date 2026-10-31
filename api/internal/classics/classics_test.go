package classics_test

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/Bolajiomo99/E-Cinema/api/internal/classics"
	"github.com/Bolajiomo99/E-Cinema/api/internal/db"
)

func TestRequests(t *testing.T) {
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
	var a string
	if err := p.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash) VALUES ('classic@example.com', 'C', '!')
	  ON CONFLICT (email) DO UPDATE SET name = 'C' RETURNING id`).Scan(&a); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, `DELETE FROM classic_votes WHERE account_id = $1`, a); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, `DELETE FROM classics WHERE id = 'kano-nights-2001'`); err != nil {
		t.Fatal(err)
	}
	s := classics.Store{DB: p}
	if err := s.Vote(ctx, "lagos-lights-2009", a, "free"); !errors.Is(err, classics.ErrPlan) {
		t.Fatalf("free member voted: %v", err)
	}
	if err := s.Vote(ctx, "nope-1999", a, "pro"); !errors.Is(err, classics.ErrNotFound) {
		t.Fatalf("unknown title: %v", err)
	}
	for i := 0; i < 2; i++ {
		if err := s.Vote(ctx, "lagos-lights-2009", a, "pro"); err != nil {
			t.Fatal(err)
		}
	}
	id, err := s.Suggest(ctx, a, "enterprise", "  Kano   Nights ", 2001)
	if err != nil || id != "kano-nights-2001" {
		t.Fatalf("suggest = %q, %v", id, err)
	}
	list, err := s.List(ctx, a)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]classics.Classic{}
	for _, c := range list {
		got[c.ID] = c
	}
	if c := got["lagos-lights-2009"]; !c.Mine || c.Requests < 1 || !c.FromVault {
		t.Fatalf("lagos = %+v", c)
	}
	if c := got["kano-nights-2001"]; !c.Mine || c.Requests != 1 || c.FromVault || c.Title != "Kano Nights" {
		t.Fatalf("kano = %+v", c)
	}
	if err := s.Unvote(ctx, "lagos-lights-2009", a); err != nil {
		t.Fatal(err)
	}
	list, _ = s.List(ctx, a)
	for _, c := range list {
		if c.ID == "lagos-lights-2009" && c.Mine {
			t.Fatal("request not taken back")
		}
	}
}
