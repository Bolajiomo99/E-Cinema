package accounts_test

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
)

func TestFaceLock(t *testing.T) {
	s, _ := store(t)
	ctx := context.Background()
	a, sess, err := s.SignUp(ctx, "face@example.com", "Face", pw, "Laptop")
	if err != nil {
		t.Fatal(err)
	}
	// Reading the same failed attempt again does not count twice.
	for i := 0; i < 3; i++ {
		if lock, err := s.RecordFaceFailure(ctx, a.ID, "att-1", "Phone", "Togo"); err != nil || lock != nil {
			t.Fatalf("repeat read %d: %+v %v", i, lock, err)
		}
	}
	for i := 2; i <= 4; i++ {
		if lock, err := s.RecordFaceFailure(ctx, a.ID, fmt.Sprintf("att-%d", i), "Phone", "Togo"); err != nil || lock != nil {
			t.Fatalf("attempt %d: %+v %v", i, lock, err)
		}
	}
	lock, err := s.RecordFaceFailure(ctx, a.ID, "att-5", "Phone", "Togo")
	if err != nil || lock == nil || len(lock.Code) != 6 || lock.Email != "face@example.com" || lock.Place != "Togo" {
		t.Fatalf("fifth failure locks: %+v %v", lock, err)
	}
	if _, _, err := s.Authenticate(ctx, sess.Token); !errors.Is(err, accounts.ErrNoSession) {
		t.Fatalf("devices signed out: %v", err)
	}
	if _, _, err := s.SignIn(ctx, "face@example.com", pw, "Laptop"); !errors.Is(err, accounts.ErrFaceLocked) {
		t.Fatalf("sign in while locked: %v", err)
	}
	if again, err := s.RecordFaceFailure(ctx, a.ID, "att-6", "Phone", "Togo"); err != nil || again != nil {
		t.Fatalf("already locked sends no second email: %+v %v", again, err)
	}
	if _, _, err := s.StartUnlock(ctx, "face@example.com", "12345x"); !errors.Is(err, accounts.ErrBadCode) {
		t.Fatalf("wrong code: %v", err)
	}
	if _, _, err := s.StartUnlock(ctx, "other@example.com", lock.Code); !errors.Is(err, accounts.ErrBadCode) {
		t.Fatalf("other email: %v", err)
	}
	token, id, err := s.StartUnlock(ctx, "face@example.com", lock.Code)
	if err != nil || id != a.ID || token == "" {
		t.Fatalf("start unlock: %v", err)
	}
	if got, err := s.UnlockAccount(ctx, token); err != nil || got != a.ID {
		t.Fatalf("token resolves: %v", err)
	}
	if err := s.FinishUnlock(ctx, token); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.SignIn(ctx, "face@example.com", pw, "Laptop"); err != nil {
		t.Fatalf("sign in after unlock: %v", err)
	}
	if err := s.FinishUnlock(ctx, token); !errors.Is(err, accounts.ErrBadCode) {
		t.Fatalf("token reused: %v", err)
	}
	if lock, err := s.ResendUnlockCode(ctx, "face@example.com"); err != nil || lock != nil {
		t.Fatalf("no code for an unlocked account: %+v %v", lock, err)
	}
}
