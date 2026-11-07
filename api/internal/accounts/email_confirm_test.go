package accounts_test

import (
	"context"
	"errors"
	"testing"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
)

func TestConfirmEmail(t *testing.T) {
	s, _ := store(t)
	ctx := context.Background()
	a, _, err := s.SignUp(ctx, "conf@example.com", "Conf", pw, "Laptop")
	if err != nil {
		t.Fatal(err)
	}
	if a.EmailVerified {
		t.Fatal("a new account starts unconfirmed")
	}
	got, err := s.IssueEmailCode(ctx, a.ID)
	if err != nil || len(got.Code) != 6 || got.Email != "conf@example.com" || got.Phone != "" {
		t.Fatalf("issue: %+v %v", got, err)
	}
	wrong := "000000"
	if got.Code == wrong {
		wrong = "111111"
	}
	if err := s.ConfirmEmail(ctx, a.ID, wrong); !errors.Is(err, accounts.ErrBadCode) {
		t.Fatalf("wrong code: %v", err)
	}
	if err := s.ConfirmEmail(ctx, a.ID, got.Code); err != nil {
		t.Fatal(err)
	}
	me, _, err := s.SignIn(ctx, "conf@example.com", pw, "Phone")
	if err != nil || !me.EmailVerified {
		t.Fatalf("after confirm: %+v %v", me, err)
	}
	if _, err := s.IssueEmailCode(ctx, a.ID); !errors.Is(err, accounts.ErrBadInput) {
		t.Fatalf("second code after confirm: %v", err)
	}
	if err := s.ConfirmEmail(ctx, a.ID, got.Code); !errors.Is(err, accounts.ErrBadCode) {
		t.Fatalf("code reused: %v", err)
	}
}
