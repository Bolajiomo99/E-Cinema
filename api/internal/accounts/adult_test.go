package accounts_test

import (
	"context"
	"errors"
	"testing"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
)

// The 18+ unlock asks for an adult PIN and a one-time code before each stage payment.
func TestAdultPINAndGrant(t *testing.T) {
	s, _ := store(t)
	s.SMS = nil
	ctx := context.Background()
	a, _, err := s.SignUp(ctx, "adult@example.com", "Ada", pw, "x")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SetAdultPIN(ctx, a.ID, "4821"); !errors.Is(err, accounts.ErrNotAdult) {
		t.Fatalf("unverified PIN: %v", err)
	}
	if _, err := s.DB.Exec(ctx, `UPDATE accounts SET id_verified_at = now(), face_verified_at = now() WHERE id = $1`, a.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.IssueAdultCode(ctx, a.ID); !errors.Is(err, accounts.ErrNoPIN) {
		t.Fatalf("code before PIN: %v", err)
	}
	if err := s.SetAdultPIN(ctx, a.ID, "12a4"); !errors.Is(err, accounts.ErrBadInput) {
		t.Fatalf("letters in PIN: %v", err)
	}
	if err := s.SetAdultPIN(ctx, a.ID, "4821"); err != nil {
		t.Fatal(err)
	}
	st, err := s.Adult(ctx, a.ID)
	if err != nil || !st.Verified || !st.PINSet || st.VerifiedAt == nil {
		t.Fatalf("status = %+v, %v", st, err)
	}
	code, err := s.IssueAdultCode(ctx, a.ID)
	if err != nil || len(code.Code) != 6 || code.Email != "adult@example.com" {
		t.Fatalf("code = %+v, %v", code, err)
	}
	if _, err := s.AdultGrant(ctx, a.ID, "0000", code.Code); !errors.Is(err, accounts.ErrBadPIN) {
		t.Fatalf("wrong PIN: %v", err)
	}
	grant, err := s.AdultGrant(ctx, a.ID, "4821", code.Code)
	if err != nil || grant == "" {
		t.Fatalf("grant: %v", err)
	}
	if err := s.UseAdultGrant(ctx, a.ID, grant); err != nil {
		t.Fatal(err)
	}
	if err := s.UseAdultGrant(ctx, a.ID, grant); !errors.Is(err, accounts.ErrBadGrant) {
		t.Fatalf("grant reused: %v", err)
	}
	// The code was spent with the grant.
	if _, err := s.AdultGrant(ctx, a.ID, "4821", code.Code); !errors.Is(err, accounts.ErrBadCode) {
		t.Fatalf("code reused: %v", err)
	}
	// Five wrong PINs pause adult payments.
	for i := 0; i < accounts.PINTries-1; i++ {
		if _, err := s.AdultGrant(ctx, a.ID, "9999", "000000"); !errors.Is(err, accounts.ErrBadPIN) {
			t.Fatalf("try %d: %v", i, err)
		}
	}
	if _, err := s.AdultGrant(ctx, a.ID, "9999", "000000"); !errors.Is(err, accounts.ErrPINPaused) {
		t.Fatalf("fifth wrong PIN: %v", err)
	}
	if _, err := s.AdultGrant(ctx, a.ID, "4821", "000000"); !errors.Is(err, accounts.ErrPINPaused) {
		t.Fatalf("right PIN while paused: %v", err)
	}
}
