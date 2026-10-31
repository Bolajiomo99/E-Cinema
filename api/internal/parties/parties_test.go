package parties_test

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/Bolajiomo99/E-Cinema/api/internal/db"
	"github.com/Bolajiomo99/E-Cinema/api/internal/parties"
	"github.com/jackc/pgx/v5/pgxpool"
)

func pool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	p, err := db.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(p.Close)
	if err := db.Migrate(ctx, p); err != nil {
		t.Fatal(err)
	}
	return p
}

func account(t *testing.T, p *pgxpool.Pool, email, name string) string {
	t.Helper()
	var id string
	if err := p.QueryRow(context.Background(), `INSERT INTO accounts (email, name, password_hash) VALUES ($1, $2, '!')
	  ON CONFLICT (email) DO UPDATE SET name = $2 RETURNING id`, email, name).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestPartyLifecycle(t *testing.T) {
	p := pool(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `DELETE FROM parties WHERE showtime_id IN ('party-test', 'party-old');
	  INSERT INTO showtimes VALUES ('party-test', 'Tide', 'S', now() + interval '1 hour', 90, 10, 500, 'USD') ON CONFLICT (id) DO NOTHING;
	  INSERT INTO showtimes VALUES ('party-old', 'Old', 'S', now() - interval '1 day', 90, 10, 500, 'USD') ON CONFLICT (id) DO NOTHING`); err != nil {
		t.Fatal(err)
	}
	s := parties.Store{DB: p}
	host := account(t, p, "party-host@example.com", "Tolu")
	friend := account(t, p, "party-friend@example.com", "Riya")
	stranger := account(t, p, "party-stranger@example.com", "Sam")

	if _, err := s.Create(ctx, host, parties.New{ShowtimeID: "party-old", Name: "Late", Visibility: "link"}); !errors.Is(err, parties.ErrEnded) {
		t.Fatalf("party for an ended premiere: %v", err)
	}
	if _, err := s.Create(ctx, host, parties.New{ShowtimeID: "party-test", Name: " ", Visibility: "link"}); !errors.Is(err, parties.ErrBadInput) {
		t.Fatalf("blank name: %v", err)
	}
	open, err := s.Create(ctx, host, parties.New{ShowtimeID: "party-test", Name: "Tolu's party", Visibility: "link", Rules: []string{"spoiler-filter", "nonsense"}})
	if err != nil {
		t.Fatal(err)
	}
	if !open.IsHost || !open.Joined || open.Members != 1 || len(open.Rules) != 1 || open.Film != "Tide" {
		t.Fatalf("created = %+v", open)
	}
	if got, err := s.Join(ctx, open.Code, friend, "party-friend@example.com"); err != nil || got.Members != 2 || !got.Joined || got.IsHost {
		t.Fatalf("join = %+v, %v", got, err)
	}
	if _, err := s.Join(ctx, open.Code, friend, "party-friend@example.com"); err != nil {
		t.Fatal("joining twice should be harmless")
	}

	closed, err := s.Create(ctx, host, parties.New{ShowtimeID: "party-test", Name: "Family", Visibility: "invite", Invite: []string{"Party-Friend@Example.com"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(closed.Invited) != 1 || closed.Invited[0] != "party-friend@example.com" {
		t.Fatalf("invites = %v", closed.Invited)
	}
	if _, err := s.Join(ctx, closed.Code, stranger, "party-stranger@example.com"); !errors.Is(err, parties.ErrNotInvited) {
		t.Fatalf("stranger joined an invite-only party: %v", err)
	}
	if _, err := s.Join(ctx, closed.Code, friend, "party-friend@example.com"); err != nil {
		t.Fatal(err)
	}

	// The stranger sees the open party but not the invite-only one; members see both, theirs first.
	list, err := s.ForViewer(ctx, stranger, 50)
	if err != nil {
		t.Fatal(err)
	}
	for _, x := range list {
		if x.Code == closed.Code {
			t.Fatal("invite-only party listed to a stranger")
		}
	}
	mine, err := s.ForViewer(ctx, friend, 50)
	if err != nil || len(mine) < 2 || !mine[0].Joined {
		t.Fatalf("friend's list = %+v, %v", mine, err)
	}

	if err := s.Leave(ctx, open.Code, host); !errors.Is(err, parties.ErrHostLeaves) {
		t.Fatalf("host leave: %v", err)
	}
	if err := s.Leave(ctx, open.Code, friend); err != nil {
		t.Fatal(err)
	}
	if err := s.End(ctx, open.Code, friend); !errors.Is(err, parties.ErrNotFound) {
		t.Fatal("only the host may end a party")
	}
	if err := s.End(ctx, open.Code, host); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get(ctx, open.Code, host); !errors.Is(err, parties.ErrNotFound) {
		t.Fatal("ended party still found")
	}
}
