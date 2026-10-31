package rooms_test

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/db"
	"github.com/Bolajiomo99/E-Cinema/api/internal/rooms"
	"github.com/Bolajiomo99/E-Cinema/api/internal/tickets"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestClean(t *testing.T) {
	if got, err := rooms.Clean("  hi\x00 there\n "); err != nil || got != "hi there" {
		t.Fatalf("Clean = %q, %v", got, err)
	}
	for _, bad := range []string{"", "   ", "\x00\x01", strings.Repeat("é", rooms.MaxRunes+1)} {
		if _, err := rooms.Clean(bad); !errors.Is(err, rooms.ErrEmpty) {
			t.Fatalf("Clean(%q) err = %v", bad, err)
		}
	}
	if _, err := rooms.Clean(strings.Repeat("é", rooms.MaxRunes)); err != nil {
		t.Fatal("500 characters should be allowed")
	}
}

func TestPasses(t *testing.T) {
	p := rooms.Passes{Key: []byte("k1")}
	now := time.Now()
	tok := p.Issue(rooms.Pass{AccountID: "a1", ShowtimeID: "s1", Name: "Tolu", Expires: now.Add(time.Minute)})
	got, err := p.Check(tok, "s1", now)
	if err != nil || got.AccountID != "a1" || got.Name != "Tolu" {
		t.Fatalf("Check = %+v, %v", got, err)
	}
	if _, err := p.Check(tok, "s2", now); !errors.Is(err, rooms.ErrBadPass) {
		t.Fatal("a pass must only open its own screening")
	}
	if _, err := p.Check(tok, "s1", now.Add(2*time.Minute)); !errors.Is(err, rooms.ErrBadPass) {
		t.Fatal("expired pass accepted")
	}
	if _, err := (rooms.Passes{Key: []byte("k2")}).Check(tok, "s1", now); !errors.Is(err, rooms.ErrBadPass) {
		t.Fatal("pass signed with another key accepted")
	}
	forged := "YTIfczEfOTk5OTk5OTk5OR9Ub2x1" + tok[strings.Index(tok, "."):]
	if _, err := p.Check(forged, "s1", now); !errors.Is(err, rooms.ErrBadPass) {
		t.Fatal("tampered pass accepted")
	}
	if _, err := (rooms.Passes{}).Check(tok, "s1", now); !errors.Is(err, rooms.ErrBadPass) {
		t.Fatal("no key must reject everything")
	}
}

func TestViewerCodeStable(t *testing.T) {
	a, b := rooms.ViewerCode([]byte("k"), "acct-1"), rooms.ViewerCode([]byte("k"), "acct-1")
	if a != b || len(a) != 8 || a == rooms.ViewerCode([]byte("k"), "acct-2") {
		t.Fatalf("codes %q %q", a, b)
	}
}

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

func account(t *testing.T, p *pgxpool.Pool, email string) string {
	t.Helper()
	var id string
	err := p.QueryRow(context.Background(), `INSERT INTO accounts (email, name, password_hash) VALUES ($1, 'T', '!') 
	  ON CONFLICT (email) DO UPDATE SET name = 'T' RETURNING id`, email).Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestTicketsAndChatLimits(t *testing.T) {
	p := pool(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `DELETE FROM room_messages WHERE showtime_id = 'room-test';
	  DELETE FROM holds WHERE showtime_id = 'room-test';
	  INSERT INTO showtimes VALUES ('room-test', 'F', 'S', now() + interval '1 hour', 90, 10, 500, 'USD') ON CONFLICT (id) DO UPDATE SET starts_at = EXCLUDED.starts_at`); err != nil {
		t.Fatal(err)
	}
	buyer := account(t, p, "room-buyer@example.com")
	other := account(t, p, "room-other@example.com")
	ts := tickets.Store{DB: p}

	h, err := ts.Hold(ctx, "room-test", "v", 1, buyer)
	if err != nil {
		t.Fatal(err)
	}
	if ok, _ := ts.HasTicket(ctx, "room-test", buyer); ok {
		t.Fatal("an unpaid hold is not a ticket")
	}
	if err := ts.AttachOrder(ctx, h.ID, "room-order"); err != nil {
		t.Fatal(err)
	}
	if err := ts.MarkPaid(ctx, "room-order", "room-capture"); err != nil {
		t.Fatal(err)
	}
	if ok, _ := ts.HasTicket(ctx, "room-test", buyer); !ok {
		t.Fatal("paid buyer has no ticket")
	}
	if ok, _ := ts.HasTicket(ctx, "room-test", other); ok {
		t.Fatal("someone else got in on the buyer's ticket")
	}
	t.Cleanup(func() { p.Exec(ctx, `DELETE FROM holds WHERE paypal_order_id = 'room-order'`) })

	rs := rooms.Store{DB: p}
	// Two tabs sending at once: only one message gets through the one-per-second limit.
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := rs.Post(ctx, "room-test", buyer, "Tolu", "hello")
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	var ok, slow int
	for err := range errs {
		switch {
		case err == nil:
			ok++
		case errors.Is(err, rooms.ErrTooFast):
			slow++
		default:
			t.Fatal(err)
		}
	}
	if ok != 1 || slow != 1 {
		t.Fatalf("ok=%d slow=%d", ok, slow)
	}
	msgs, err := rs.Recent(ctx, "room-test", buyer, 50)
	if err != nil || len(msgs) != 1 || !msgs[0].Mine || msgs[0].Body != "hello" {
		t.Fatalf("Recent = %+v, %v", msgs, err)
	}
	theirs, _ := rs.Recent(ctx, "room-test", other, 50)
	if theirs[0].Mine {
		t.Fatal("message marked as mine for another viewer")
	}
}

func TestPassCarriesCountry(t *testing.T) {
	p := rooms.Passes{Key: []byte("k1")}
	now := time.Now()
	got, err := p.Check(p.Issue(rooms.Pass{AccountID: "a1", ShowtimeID: "s1", Name: "Tolu", Expires: now.Add(time.Minute), Country: "NG"}), "s1", now)
	if err != nil || got.Country != "NG" || got.Name != "Tolu" {
		t.Fatalf("Check = %+v, %v", got, err)
	}
	old, err := p.Check(p.Issue(rooms.Pass{AccountID: "a1", ShowtimeID: "s1", Name: "Tolu", Expires: now.Add(time.Minute)}), "s1", now)
	if err != nil || old.Country != "" {
		t.Fatalf("pass without a country = %+v, %v", old, err)
	}
}
