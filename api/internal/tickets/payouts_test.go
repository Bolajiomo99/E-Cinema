package tickets_test

import (
	"context"
	"errors"
	"testing"

	"github.com/Bolajiomo99/E-Cinema/api/internal/tickets"
)

func paidSeats(t *testing.T, s tickets.Store, id string, seats int, order string) {
	t.Helper()
	ctx := context.Background()
	h, err := s.Hold(ctx, id, "viewer", seats)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.AttachOrder(ctx, h.ID, order); err != nil {
		t.Fatal(err)
	}
	if err := s.MarkPaid(ctx, order, "cap-"+order); err != nil {
		t.Fatal(err)
	}
}

func TestStudioPayout(t *testing.T) {
	s := store(t)
	ctx := context.Background()
	newShow(t, s, "payout-test", 100)
	s.DB.Exec(ctx, `UPDATE showtimes SET studio = 'Lagoon Gate Pictures' WHERE id = 'payout-test'`)
	s.DB.Exec(ctx, `DELETE FROM holds WHERE paypal_order_id IN ('PAYOUTA', 'PAYOUTB')`)
	paidSeats(t, s, "payout-test", 2, "PAYOUTA")
	paidSeats(t, s, "payout-test", 1, "PAYOUTB")
	if _, err := s.Hold(ctx, "payout-test", "viewer", 4); err != nil { // unpaid hold must not count
		t.Fatal(err)
	}

	if _, err := s.ClaimPayout(ctx, "payout-test"); !errors.Is(err, tickets.ErrNotEnded) {
		t.Fatalf("claim before the end: got %v", err)
	}
	s.DB.Exec(ctx, `UPDATE showtimes SET starts_at = now() - interval '3 hours' WHERE id = 'payout-test'`)

	st, err := s.ClaimPayout(ctx, "payout-test")
	if err != nil {
		t.Fatal(err)
	}
	if st.PaidSeats != 3 || st.GrossCents != 1500 || st.StudioCents != 1050 || st.Status != "pending" {
		t.Fatalf("unexpected statement %+v", st)
	}
	if st.SenderBatchID != "ecinema-payout-test" || st.PayoutEmail == "" {
		t.Fatalf("missing payout details %+v", st)
	}

	// A late sale after the claim must not change the frozen amount.
	s.DB.Exec(ctx, `UPDATE showtimes SET starts_at = now() + interval '1 day' WHERE id = 'payout-test'`)
	paidSeats(t, s, "payout-test", 1, "PAYOUTC")
	again, err := s.ClaimPayout(ctx, "payout-test")
	if err != nil || again.StudioCents != 1050 {
		t.Fatalf("second claim changed the payout: %+v %v", again, err)
	}

	if err := s.RecordPayout(ctx, "payout-test", "sent", "BATCH1"); err != nil {
		t.Fatal(err)
	}
	if err := s.RecordPayout(ctx, "payout-test", "failed", ""); !errors.Is(err, tickets.ErrNoPayout) {
		t.Fatalf("a sent payout was changed: %v", err)
	}
	done, _ := s.Statement(ctx, "payout-test")
	if done.Status != "sent" || done.PaypalBatchID != "BATCH1" {
		t.Fatalf("unexpected final statement %+v", done)
	}
	s.DB.Exec(ctx, `DELETE FROM holds WHERE paypal_order_id = 'PAYOUTC'`)
}

func TestNothingDueAndUnknownStudio(t *testing.T) {
	s := store(t)
	ctx := context.Background()
	newShow(t, s, "payout-empty", 10)
	s.DB.Exec(ctx, `UPDATE showtimes SET studio = 'Hanbit Story House', starts_at = now() - interval '1 day' WHERE id = 'payout-empty'`)
	st, err := s.ClaimPayout(ctx, "payout-empty")
	if err != nil || st.Status != "nothing_due" {
		t.Fatalf("empty screening: %+v %v", st, err)
	}

	newShow(t, s, "payout-nostudio", 10)
	s.DB.Exec(ctx, `UPDATE showtimes SET starts_at = now() - interval '1 day' WHERE id = 'payout-nostudio'`)
	if _, err := s.ClaimPayout(ctx, "payout-nostudio"); !errors.Is(err, tickets.ErrNoStudio) {
		t.Fatalf("unknown studio: got %v", err)
	}
	if err := s.RecordPayout(ctx, "payout-empty", "paid", ""); !errors.Is(err, tickets.ErrBadOutcome) {
		t.Fatalf("bad status accepted: %v", err)
	}
}
