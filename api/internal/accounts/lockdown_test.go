package accounts_test

import (
	"context"
	"errors"
	"testing"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
)

// Lock down mode (Figma 117:1773): no sign-ups, no new devices; known devices, executives and the CEO still get in.
func TestLockdown(t *testing.T) {
	s, _ := store(t)
	ctx := context.Background()
	s.Trusted = []string{"ld-ceo@example.com"}
	set := func(on bool) {
		if _, err := s.DB.Exec(ctx, `UPDATE security_settings SET lockdown = $1 WHERE id = 1`, on); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		set(false)
		s.DB.Exec(ctx, `DELETE FROM executives WHERE email = 'ld-cto@example.com'`)
	})
	if _, _, err := s.SignUp(ctx, "ld-viewer@example.com", "Ada Viewer", pw, "Chrome on Mac"); err != nil {
		t.Fatal(err)
	}
	s.SignUp(ctx, "ld-ceo@example.com", "Bolaji CEO", pw, "Chrome on Mac")
	s.SignUp(ctx, "ld-cto@example.com", "Femi CTO", pw, "Chrome on Mac")
	s.DB.Exec(ctx, `INSERT INTO executives (email, role) VALUES ('ld-cto@example.com', 'cto') ON CONFLICT DO NOTHING`)
	set(true)
	if _, _, err := s.SignUp(ctx, "ld-new@example.com", "New Person", pw, "Chrome on Mac"); !errors.Is(err, accounts.ErrLockdown) {
		t.Fatalf("sign-up in lock down: %v", err)
	}
	var n int
	s.DB.QueryRow(ctx, `SELECT count(*) FROM accounts WHERE email = 'ld-new@example.com'`).Scan(&n)
	if n != 0 {
		t.Fatal("refused sign-up still made an account")
	}
	if _, _, err := s.SignIn(ctx, "ld-viewer@example.com", pw, "Safari on iPhone"); !errors.Is(err, accounts.ErrLockdown) {
		t.Fatalf("new device in lock down: %v", err)
	}
	if _, _, err := s.SignIn(ctx, "ld-viewer@example.com", pw, "Chrome on Mac"); err != nil {
		t.Fatalf("known device in lock down: %v", err)
	}
	for _, e := range []string{"ld-ceo@example.com", "ld-cto@example.com"} {
		if _, _, err := s.SignIn(ctx, e, pw, "Firefox on Linux"); err != nil {
			t.Fatalf("%s in lock down: %v", e, err)
		}
	}
	set(false)
	if _, _, err := s.SignIn(ctx, "ld-viewer@example.com", pw, "Safari on iPhone"); err != nil {
		t.Fatalf("after lock down: %v", err)
	}
}
