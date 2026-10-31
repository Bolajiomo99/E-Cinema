package tickets_test

import (
	"context"
	"errors"
	"os"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/Bolajiomo99/E-Cinema/api/internal/db"
	"github.com/Bolajiomo99/E-Cinema/api/internal/tickets"
)

func store(t *testing.T) tickets.Store {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := db.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	return tickets.Store{DB: pool}
}

func newShow(t *testing.T, s tickets.Store, id string, capacity int) {
	t.Helper()
	ctx := context.Background()
	s.DB.Exec(ctx, `DELETE FROM studio_payouts WHERE showtime_id = $1`, id)
	s.DB.Exec(ctx, `DELETE FROM holds WHERE showtime_id = $1`, id)
	s.DB.Exec(ctx, `DELETE FROM showtimes WHERE id = $1`, id)
	if _, err := s.DB.Exec(ctx, `INSERT INTO showtimes VALUES ($1, 'Test Film', 'Test Studio', now() + interval '1 day', 90, $2, 500, 'USD')`, id, capacity); err != nil {
		t.Fatal(err)
	}
}

// 300 buyers race for 50 seats: exactly 50 must win.
func TestNeverOversells(t *testing.T) {
	s := store(t)
	newShow(t, s, "race-test", 50)
	var won, soldOut atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 300; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := s.Hold(context.Background(), "race-test", "viewer", 1, "")
			switch {
			case err == nil:
				won.Add(1)
			case errors.Is(err, tickets.ErrSoldOut):
				soldOut.Add(1)
			default:
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if won.Load() != 50 || soldOut.Load() != 250 {
		t.Fatalf("won %d, sold out %d; want 50 and 250", won.Load(), soldOut.Load())
	}
	st, _ := s.Get(context.Background(), "race-test")
	if st.Available != 0 {
		t.Fatalf("available %d, want 0", st.Available)
	}
}

func TestPaidIsIdempotentAndExpiredHoldsFree(t *testing.T) {
	s := store(t)
	ctx := context.Background()
	newShow(t, s, "pay-test", 3)
	h, err := s.Hold(ctx, "pay-test", "viewer", 2, "")
	if err != nil {
		t.Fatal(err)
	}
	if h.TotalCents != 1000 {
		t.Fatalf("total %d, want 1000", h.TotalCents)
	}
	if err := s.AttachOrder(ctx, h.ID, "ORDER-PAY-TEST"); err != nil {
		t.Fatal(err)
	}
	if err := s.MarkPaid(ctx, "ORDER-PAY-TEST", "CAPTURE-1"); err != nil {
		t.Fatal(err)
	}
	if err := s.MarkPaid(ctx, "ORDER-PAY-TEST", "CAPTURE-1"); err != nil {
		t.Fatalf("repeat webhook should be accepted: %v", err)
	}
	if err := s.MarkPaid(ctx, "ORDER-PAY-TEST", "CAPTURE-OTHER"); !errors.Is(err, tickets.ErrNoHold) {
		t.Fatalf("different capture should be refused, got %v", err)
	}

	h2, err := s.Hold(ctx, "pay-test", "viewer2", 1, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Hold(ctx, "pay-test", "viewer3", 1, ""); !errors.Is(err, tickets.ErrSoldOut) {
		t.Fatalf("want sold out, got %v", err)
	}
	// Expire the second hold: its seat comes back.
	s.DB.Exec(ctx, `UPDATE holds SET expires_at = now() - interval '1 second' WHERE id = $1`, h2.ID)
	if _, err := s.Hold(ctx, "pay-test", "viewer3", 1, ""); err != nil {
		t.Fatalf("expired hold should free its seat: %v", err)
	}
}

func TestSeatLimits(t *testing.T) {
	s := store(t)
	newShow(t, s, "limit-test", 100)
	for _, n := range []int{0, 11, -1} {
		if _, err := s.Hold(context.Background(), "limit-test", "v", n, ""); !errors.Is(err, tickets.ErrBadSeats) {
			t.Fatalf("seats %d: want ErrBadSeats, got %v", n, err)
		}
	}
	if _, err := s.Hold(context.Background(), "missing", "v", 1, ""); !errors.Is(err, tickets.ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
}

// Adult screenings sell only to accounts that passed the face and ID check.
func TestAdultScreeningsNeedVerifiedAccount(t *testing.T) {
	s := store(t)
	ctx := context.Background()
	newShow(t, s, "adult-test", 10)
	if _, err := s.DB.Exec(ctx, `UPDATE showtimes SET adult = true WHERE id = 'adult-test'`); err != nil {
		t.Fatal(err)
	}
	var id string
	err := s.DB.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash) VALUES ('adult-'||gen_random_uuid()||'@example.com', 'A', 'x') RETURNING id`).Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		s.DB.Exec(ctx, `DELETE FROM holds WHERE showtime_id = 'adult-test'`)
		s.DB.Exec(ctx, `DELETE FROM accounts WHERE id = $1`, id)
	})
	if _, err := s.Hold(ctx, "adult-test", "v", 1, ""); !errors.Is(err, tickets.ErrAdult) {
		t.Fatalf("guest: want ErrAdult, got %v", err)
	}
	if _, err := s.Hold(ctx, "adult-test", "v", 1, id); !errors.Is(err, tickets.ErrAdult) {
		t.Fatalf("unverified: want ErrAdult, got %v", err)
	}
	if _, err := s.DB.Exec(ctx, `UPDATE accounts SET face_verified_at = now(), id_verified_at = now() WHERE id = $1`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Hold(ctx, "adult-test", "v", 1, id); err != nil {
		t.Fatalf("verified: %v", err)
	}
}

// A viewer sees their own paid seats and live holds, and can give a hold back.
func TestMineAndRelease(t *testing.T) {
	s := store(t)
	ctx := context.Background()
	newShow(t, s, "mine-test", 10)
	var id, other string
	if err := s.DB.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash) VALUES ('mine-'||gen_random_uuid()||'@example.com', 'M', 'x') RETURNING id`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if err := s.DB.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash) VALUES ('other-'||gen_random_uuid()||'@example.com', 'O', 'x') RETURNING id`).Scan(&other); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		s.DB.Exec(ctx, `DELETE FROM holds WHERE showtime_id = 'mine-test'`)
		s.DB.Exec(ctx, `DELETE FROM accounts WHERE id IN ($1, $2)`, id, other)
	})
	paid, _ := s.Hold(ctx, "mine-test", "v", 2, id)
	s.AttachOrder(ctx, paid.ID, "ORDER-MINE-1")
	if err := s.MarkPaid(ctx, "ORDER-MINE-1", "CAP-MINE-1"); err != nil {
		t.Fatal(err)
	}
	held, _ := s.Hold(ctx, "mine-test", "v", 1, id)
	s.Hold(ctx, "mine-test", "v", 1, other)
	list, err := s.Mine(ctx, id)
	if err != nil || len(list) != 2 {
		t.Fatalf("mine: %v %+v", err, list)
	}
	if err := s.ReleaseMine(ctx, other, held.ID); !errors.Is(err, tickets.ErrNoHold) {
		t.Fatalf("someone else's hold: %v", err)
	}
	if err := s.ReleaseMine(ctx, id, held.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.ReleaseMine(ctx, id, paid.ID); !errors.Is(err, tickets.ErrNoHold) {
		t.Fatalf("paid seats cannot be released: %v", err)
	}
	if list, _ := s.Mine(ctx, id); len(list) != 1 || list[0].Status != "paid" {
		t.Fatalf("after release: %+v", list)
	}
}

// Late entry: seats sell while the film is running, but not once it has ended.
func TestLateEntryUntilTheEnd(t *testing.T) {
	s := store(t)
	ctx := context.Background()
	newShow(t, s, "late-test", 10)
	if _, err := s.DB.Exec(ctx, `UPDATE showtimes SET starts_at = now() - interval '30 minutes' WHERE id = 'late-test'`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Hold(ctx, "late-test", "viewer", 1, ""); err != nil {
		t.Fatalf("hold during the film: %v", err)
	}
	if _, err := s.DB.Exec(ctx, `UPDATE showtimes SET starts_at = now() - interval '2 hours' WHERE id = 'late-test'`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Hold(ctx, "late-test", "viewer", 1, ""); !errors.Is(err, tickets.ErrEnded) {
		t.Fatalf("hold after the end: %v, want ErrEnded", err)
	}
}

func TestTonightCountsPaidSeatsByCountry(t *testing.T) {
	s := store(t)
	ctx := context.Background()
	newShow(t, s, "tonight-test", 20)
	if _, err := s.DB.Exec(ctx, `UPDATE showtimes SET starts_at = now() + interval '3 hours' WHERE id = 'tonight-test'`); err != nil {
		t.Fatal(err)
	}
	acct := func(email, cc string) string {
		var id string
		s.DB.Exec(ctx, `DELETE FROM accounts WHERE email = $1`, email)
		if err := s.DB.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash, country) VALUES ($1, 'T', '!', NULLIF($2, '')) RETURNING id`, email, cc).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	pay := func(account string, seats int, paid bool) {
		h, err := s.Hold(ctx, "tonight-test", "v-"+account, seats, account)
		if err != nil {
			t.Fatal(err)
		}
		if !paid {
			return
		}
		order := "ORDER-" + h.ID
		if err := s.AttachOrder(ctx, h.ID, order); err != nil {
			t.Fatal(err)
		}
		if err := s.MarkPaid(ctx, order, "CAP-"+h.ID); err != nil {
			t.Fatal(err)
		}
	}
	pay(acct("tn-ng@example.com", "NG"), 2, true)
	pay(acct("tn-ng2@example.com", "NG"), 1, true)
	pay(acct("tn-ke@example.com", "KE"), 1, true)
	pay(acct("tn-none@example.com", ""), 1, true)
	pay(acct("tn-held@example.com", "GB"), 3, false) // not paid: not counted

	list, err := s.Tonight(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, u := range list {
		if u.ShowtimeID != "tonight-test" {
			continue
		}
		if u.Seats != 5 || u.ByCountry["NG"] != 3 || u.ByCountry["KE"] != 1 || len(u.ByCountry) != 2 {
			t.Fatalf("tonight = %+v, want 5 seats, NG:3 KE:1", u)
		}
		return
	}
	t.Fatal("tonight-test missing from Tonight()")
}
