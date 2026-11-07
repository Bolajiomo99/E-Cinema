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
	h, err := s.Hold(ctx, id, "viewer", seats, "")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.AttachOrder(ctx, h.ID, order, 0); err != nil {
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
	if _, err := s.Hold(ctx, "payout-test", "viewer", 4, ""); err != nil { // unpaid hold must not count
		t.Fatal(err)
	}

	if _, err := s.ClaimPayout(ctx, "payout-test"); !errors.Is(err, tickets.ErrNotEnded) {
		t.Fatalf("claim before the end: got %v", err)
	}
	s.DB.Exec(ctx, `UPDATE showtimes SET starts_at = now() - interval '3 hours' WHERE id = 'payout-test'`)

	due, err := s.DuePayouts(ctx)
	if err != nil || !contains(due, "payout-test") {
		t.Fatalf("ended screening not listed as due: %v %v", due, err)
	}
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

	if err := s.RecordPayout(ctx, "payout-test", tickets.Outcome{Status: "sent", BatchID: "BATCH1"}); err != nil {
		t.Fatal(err)
	}
	if err := s.RecordPayout(ctx, "payout-test", tickets.Outcome{Status: "failed"}); !errors.Is(err, tickets.ErrNoPayout) {
		t.Fatalf("a sent payout was changed: %v", err)
	}
	if due, _ := s.DuePayouts(ctx); contains(due, "payout-test") {
		t.Fatal("paid screening still listed as due")
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
	if err := s.RecordPayout(ctx, "payout-empty", tickets.Outcome{Status: "paid"}); !errors.Is(err, tickets.ErrBadOutcome) {
		t.Fatalf("bad status accepted: %v", err)
	}
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// A pre-order seat bought at a saving pays the studio its share of what was charged, not the list price.
func TestStudioShareUsesChargedPrice(t *testing.T) {
	s := store(t)
	ctx := context.Background()
	newShow(t, s, "net-test", 10) // list price 500 cents
	s.DB.Exec(ctx, `UPDATE showtimes SET studio = 'Lagoon Gate Pictures' WHERE id = 'net-test'`)
	s.DB.Exec(ctx, `DELETE FROM holds WHERE paypal_order_id IN ('NETA', 'NETB')`)
	h, err := s.Hold(ctx, "net-test", "viewer", 1, "")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.AttachOrder(ctx, h.ID, "NETA", 310); err != nil {
		t.Fatal(err)
	}
	if err := s.MarkPaid(ctx, "NETA", "cap-NETA"); err != nil {
		t.Fatal(err)
	}
	paidSeats(t, s, "net-test", 1, "NETB") // no amount recorded: list price
	st, err := s.Statement(ctx, "net-test")
	if err != nil {
		t.Fatal(err)
	}
	if st.GrossCents != 810 {
		t.Fatalf("gross = %d, want 310 + 500", st.GrossCents)
	}
}

func TestBankPayout(t *testing.T) {
	s := store(t)
	ctx := context.Background()
	const studio = "Test Bank Payout Films"
	clean := func() {
		s.DB.Exec(ctx, `DELETE FROM studio_payouts WHERE showtime_id = 'payout-bank'`)
		s.DB.Exec(ctx, `DELETE FROM holds WHERE paypal_order_id = 'PAYOUTBK'`)
		s.DB.Exec(ctx, `DELETE FROM showtimes WHERE id = 'payout-bank'`)
		s.DB.Exec(ctx, `DELETE FROM studios WHERE name = $1`, studio)
	}
	clean()
	t.Cleanup(clean)
	if _, err := s.DB.Exec(ctx, `INSERT INTO studios (name, slug, status, payout_email, payout_method, payout_bank, payout_bank_code, payout_number, payout_name, payout_currency, share_bps)
	  VALUES ($1, 'test-bank-payout-films', 'verified', '', 'bank', 'Access Bank', '044', '0690000031', 'Test Bank Films', 'NGN', 7000)`, studio); err != nil {
		t.Fatal(err)
	}
	newShow(t, s, "payout-bank", 100)
	s.DB.Exec(ctx, `UPDATE showtimes SET studio = $1 WHERE id = 'payout-bank'`, studio)
	paidSeats(t, s, "payout-bank", 2, "PAYOUTBK")
	s.DB.Exec(ctx, `UPDATE showtimes SET starts_at = now() - interval '3 hours' WHERE id = 'payout-bank'`)

	st, err := s.ClaimPayout(ctx, "payout-bank")
	if err != nil || st.Method != "bank" || st.BankCode != "044" || st.AccountNumber != "0690000031" || st.Reference != "ecinema-payout-bank" {
		t.Fatalf("bank claim: %+v %v", st, err)
	}
	if err := s.RecordPayout(ctx, "payout-bank", tickets.Outcome{Status: "submitted"}); !errors.Is(err, tickets.ErrBadOutcome) {
		t.Fatalf("submitted without a transfer id: %v", err)
	}
	if err := s.RecordPayout(ctx, "payout-bank", tickets.Outcome{Status: "submitted", TransferID: "111", PaidCurrency: "NGN", PaidMinor: 1500000}); err != nil {
		t.Fatal(err)
	}
	st, _ = s.Statement(ctx, "payout-bank")
	if st.Status != "pending" || st.TransferID != "111" {
		t.Fatalf("in flight: %+v", st)
	}
	// The bank refuses it: the next attempt gets a fresh reference.
	if err := s.RecordPayout(ctx, "payout-bank", tickets.Outcome{Status: "failed"}); err != nil {
		t.Fatal(err)
	}
	st, err = s.ClaimPayout(ctx, "payout-bank")
	if err != nil || st.Status != "failed" || st.TransferID != "" || st.Reference != "ecinema-payout-bank-1" {
		t.Fatalf("after failure: %+v %v", st, err)
	}
	if err := s.RecordPayout(ctx, "payout-bank", tickets.Outcome{Status: "sent", TransferID: "222", PaidCurrency: "NGN", PaidMinor: 1500000}); err != nil {
		t.Fatal(err)
	}
	st, _ = s.Statement(ctx, "payout-bank")
	if st.Status != "sent" || st.TransferID != "222" {
		t.Fatalf("final: %+v", st)
	}
}
