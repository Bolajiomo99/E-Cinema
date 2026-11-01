package tickets_test

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/tickets"
)

// A sold-out premiere opens free seats by lottery; winners claim them for nothing.
func TestSoldOutLottery(t *testing.T) {
	s := store(t)
	ctx := context.Background()
	const id = "lottery-test"
	clean := func() {
		s.DB.Exec(ctx, `DELETE FROM lottery_entries WHERE showtime_id = $1`, id)
		s.DB.Exec(ctx, `DELETE FROM lottery_draws WHERE showtime_id = $1`, id)
		s.DB.Exec(ctx, `DELETE FROM waitlist WHERE showtime_id = $1`, id)
		s.DB.Exec(ctx, `DELETE FROM holds WHERE showtime_id = $1`, id)
		s.DB.Exec(ctx, `DELETE FROM accounts WHERE email LIKE 'lot-%@example.com'`)
	}
	clean()
	newShow(t, s, id, 80) // 80 seats -> 2 free seats
	t.Cleanup(clean)
	acct := func(n int, verified bool, phone string) string {
		var a string
		if err := s.DB.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash, id_verified_at, phone, phone_verified_at)
		  VALUES ($1, 'L', 'x', CASE WHEN $2 THEN now() END, NULLIF($3, ''), CASE WHEN $3 <> '' THEN now() END) RETURNING id`,
			fmt.Sprintf("lot-%d@example.com", n), verified, phone).Scan(&a); err != nil {
			t.Fatal(err)
		}
		return a
	}
	buyer := acct(0, true, "")
	if _, err := s.EnterLottery(ctx, id, acct(1, true, "")); !errors.Is(err, tickets.ErrNotSoldOut) {
		t.Fatalf("entering before sell-out: %v", err)
	}
	if _, err := s.DB.Exec(ctx, `INSERT INTO holds (showtime_id, seats, viewer_ref, status, expires_at, account_id) VALUES ($1, 10, 'v', 'paid', now(), $2)`, id, buyer); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec(ctx, `INSERT INTO holds (showtime_id, seats, viewer_ref, status, expires_at, created_at) VALUES ($1, 10, 'v', 'paid', now(), now() + interval '6 hours')`, id); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 6; i++ {
		if _, err := s.DB.Exec(ctx, `INSERT INTO holds (showtime_id, seats, viewer_ref, status, expires_at) VALUES ($1, 10, 'v', 'paid', now())`, id); err != nil {
			t.Fatal(err)
		}
	}
	l, err := s.LotteryState(ctx, id, "")
	if err != nil || !l.SoldOut || l.FreeSeats != 2 || l.SoldOutAfter < 359 || l.SeedHash == "" || l.Seed != "" {
		t.Fatalf("state = %+v, %v", l, err)
	}
	if _, err := s.EnterLottery(ctx, id, buyer); !errors.Is(err, tickets.ErrHasTicket) {
		t.Fatalf("buyer entering: %v", err)
	}
	if _, err := s.EnterLottery(ctx, id, acct(2, false, "")); !errors.Is(err, tickets.ErrNotVerified) {
		t.Fatalf("unverified entering: %v", err)
	}
	// Five verified people (a verified phone is unique per account) for two seats.
	var who []string
	for i, ph := range []string{"+2348000000001", "+2348000000002", "+2348000000003", "+2348000000004", ""} {
		a := acct(10+i, ph == "", ph)
		n, err := s.EnterLottery(ctx, id, a)
		if err != nil || n == 0 {
			t.Fatalf("entry %d: %v", i, err)
		}
		if again, _ := s.EnterLottery(ctx, id, a); again != n {
			t.Fatal("entering twice must keep the same entry")
		}
		who = append(who, a)
	}
	if w, err := s.Draw(ctx, id, time.Now()); err != nil || w != nil {
		t.Fatalf("draw before its time: %v %v", w, err)
	}
	winners, err := s.Draw(ctx, id, time.Now().Add(24*time.Hour))
	if err != nil || len(winners) != 2 || winners[0].Email == "" {
		t.Fatalf("winners = %+v, %v", winners, err)
	}
	if again, err := s.Draw(ctx, id, time.Now().Add(24*time.Hour)); err != nil || again != nil {
		t.Fatal("the draw runs once")
	}
	l, _ = s.LotteryState(ctx, id, winners[0].AccountID)
	if !l.Drawn || !l.Won || l.Seed == "" || l.Entries != 5 {
		t.Fatalf("winner state = %+v", l)
	}
	if err := s.ClaimWin(ctx, who[0], "00000000-0000-0000-0000-000000000000"); !errors.Is(err, tickets.ErrNoWin) {
		t.Fatalf("claiming someone else's seat: %v", err)
	}
	if err := s.ClaimWin(ctx, winners[0].AccountID, winners[0].HoldID); err != nil {
		t.Fatal(err)
	}
	if ok, _ := s.HasTicket(ctx, id, winners[0].AccountID); !ok {
		t.Fatal("claimed seat is not a ticket")
	}
	// Waitlist: nobody is told while sold out; one is told when a seat comes back.
	if err := s.JoinWaitlist(ctx, id, who[4], true); err != nil {
		t.Fatal(err)
	}
	if due, _ := s.WaitlistDue(ctx, id); len(due) != 0 {
		t.Fatalf("told while sold out: %v", due)
	}
	if _, err := s.DB.Exec(ctx, `UPDATE holds SET status = 'released' WHERE id = (SELECT id FROM holds WHERE showtime_id = $1 AND NOT lottery AND account_id IS NULL LIMIT 1)`, id); err != nil {
		t.Fatal(err)
	}
	if due, err := s.WaitlistDue(ctx, id); err != nil || len(due) != 1 || due[0].AccountID != who[4] {
		t.Fatalf("waitlist due = %+v, %v", due, err)
	}
	if due, _ := s.WaitlistDue(ctx, id); len(due) != 0 {
		t.Fatal("told twice")
	}
}
