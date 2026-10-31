package accounts_test

import (
	"context"
	"errors"
	"testing"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
)

// age moves every code back so the one-minute resend gap does not slow the test.
func age(t *testing.T, s accounts.Store) {
	t.Helper()
	if _, err := s.DB.Exec(context.Background(), `UPDATE auth_codes SET created_at = created_at - interval '2 minutes'`); err != nil {
		t.Fatal(err)
	}
}

func TestLoginCodeByEmail(t *testing.T) {
	s, _ := store(t)
	s.SMS = nil
	ctx := context.Background()
	if _, _, err := s.SignUp(ctx, "code@example.com", "Code", pw, "x"); err != nil {
		t.Fatal(err)
	}
	// Unknown accounts get a normal-looking answer and no code.
	miss, err := s.IssueCode(ctx, "nobody@example.com", "login")
	if err != nil || miss.Found || miss.Code != "" || miss.MaskedTo != "n•••@example.com" {
		t.Fatalf("unknown: %v %+v", err, miss)
	}
	got, err := s.IssueCode(ctx, "Code@Example.com", "login")
	if err != nil || !got.Found || len(got.Code) != 6 || got.Email != "code@example.com" || got.MaskedTo != "c•••@example.com" {
		t.Fatalf("issue: %v %+v", err, got)
	}
	if _, err := s.IssueCode(ctx, "code@example.com", "login"); !errors.Is(err, accounts.ErrTooSoon) {
		t.Fatalf("resend gap: %v", err)
	}
	if _, _, err := s.SignInWithCode(ctx, "code@example.com", "000000", "x"); !errors.Is(err, accounts.ErrBadCode) && got.Code != "000000" {
		t.Fatalf("wrong code: %v", err)
	}
	acct, sess, err := s.SignInWithCode(ctx, "code@example.com", got.Code, "phone")
	if err != nil || acct.Email != "code@example.com" || sess.Token == "" {
		t.Fatalf("sign in: %v", err)
	}
	// A code works once.
	if _, _, err := s.SignInWithCode(ctx, "code@example.com", got.Code, "x"); !errors.Is(err, accounts.ErrBadCode) {
		t.Fatalf("reuse: %v", err)
	}
	// An expired code says so.
	age(t, s)
	again, err := s.IssueCode(ctx, "code@example.com", "login")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec(ctx, `UPDATE auth_codes SET expires_at = now() - interval '1 second' WHERE used_at IS NULL`); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.SignInWithCode(ctx, "code@example.com", again.Code, "x"); !errors.Is(err, accounts.ErrCodeExpired) {
		t.Fatalf("expired: %v", err)
	}
}

func TestCodeTriesPauseResets(t *testing.T) {
	s, _ := store(t)
	s.SMS = nil
	ctx := context.Background()
	if _, _, err := s.SignUp(ctx, "tries@example.com", "T", pw, "x"); err != nil {
		t.Fatal(err)
	}
	got, err := s.IssueCode(ctx, "tries@example.com", "reset")
	if err != nil {
		t.Fatal(err)
	}
	wrong := "111111"
	if got.Code == wrong {
		wrong = "222222"
	}
	for i := 1; i <= accounts.CodeTries; i++ {
		_, err := s.VerifyResetCode(ctx, "tries@example.com", wrong)
		if i < accounts.CodeTries && !errors.Is(err, accounts.ErrBadCode) {
			t.Fatalf("try %d: %v", i, err)
		}
		if i == accounts.CodeTries && !errors.Is(err, accounts.ErrPaused) {
			t.Fatalf("last try: %v", err)
		}
	}
	// Even the right code no longer works, and new codes are paused.
	if _, err := s.VerifyResetCode(ctx, "tries@example.com", got.Code); !errors.Is(err, accounts.ErrPaused) {
		t.Fatalf("right code after pause: %v", err)
	}
	age(t, s)
	out, err := s.IssueCode(ctx, "tries@example.com", "reset")
	if !errors.Is(err, accounts.ErrPaused) || out.PausedFor < 25*60 {
		t.Fatalf("pause: %v %+v", err, out)
	}
}

func TestPasswordReset(t *testing.T) {
	s, sms := store(t)
	ctx := context.Background()
	a, _, err := s.SignUp(ctx, "reset@example.com", "R", pw, "laptop")
	if err != nil {
		t.Fatal(err)
	}
	// Verify a phone, then reset by phone: the code goes by text.
	if _, err := s.StartPhoneCheck(ctx, a.ID, "08035550199"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ConfirmPhone(ctx, a.ID, sms.code()); err != nil {
		t.Fatal(err)
	}
	got, err := s.IssueCode(ctx, "0803 555 0199", "reset")
	if err != nil || got.Phone != "+2348035550199" || got.Code != "" || got.MaskedTo != "+234 •••• 0199" {
		t.Fatalf("issue by phone: %v %+v", err, got)
	}
	token, err := s.VerifyResetCode(ctx, "+2348035550199", sms.code())
	if err != nil || token == "" {
		t.Fatalf("verify: %v", err)
	}
	if _, err := s.ResetPassword(ctx, token, "short-pass", "x", true); !errors.Is(err, accounts.ErrBadInput) {
		t.Fatalf("short: %v", err)
	}
	if _, err := s.ResetPassword(ctx, token, pw, "x", true); !errors.Is(err, accounts.ErrReusedPass) && len(pw) >= accounts.ResetPassLen {
		t.Fatalf("reuse current: %v", err)
	}
	const fresh = "a-brand-new-long-password"
	res, err := s.ResetPassword(ctx, token, fresh, "phone", true)
	if err != nil || res.SignedOut != 1 || res.LockToken == "" || res.Session.Token == "" {
		t.Fatalf("reset: %v %+v", err, res)
	}
	if _, err := s.ResetPassword(ctx, token, "another-long-password", "x", false); !errors.Is(err, accounts.ErrBadCode) {
		t.Fatalf("token reuse: %v", err)
	}
	// The new password works, by email or by the verified phone; the old one does not.
	if _, _, err := s.SignIn(ctx, "reset@example.com", pw, "x"); !errors.Is(err, accounts.ErrBadLogin) {
		t.Fatalf("old password: %v", err)
	}
	if _, _, err := s.SignIn(ctx, "+2348035550199", fresh, "x"); err != nil {
		t.Fatalf("phone sign in: %v", err)
	}
	// "This wasn't me" signs out everywhere and blocks the password.
	email, err := s.LockAccount(ctx, res.LockToken)
	if err != nil || email != "reset@example.com" {
		t.Fatalf("lock: %v %q", err, email)
	}
	if _, _, err := s.Authenticate(ctx, res.Session.Token); err == nil {
		t.Fatal("session survived the lock")
	}
	if _, _, err := s.SignIn(ctx, "reset@example.com", fresh, "x"); !errors.Is(err, accounts.ErrBadLogin) {
		t.Fatalf("password after lock: %v", err)
	}
	if _, err := s.LockAccount(ctx, res.LockToken); !errors.Is(err, accounts.ErrBadCode) {
		t.Fatalf("lock twice: %v", err)
	}
}
