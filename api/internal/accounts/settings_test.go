package accounts_test

import (
	"context"
	"errors"
	"testing"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
)

func ptr[T any](v T) *T { return &v }

func TestSettings(t *testing.T) {
	s, _ := store(t)
	ctx := context.Background()
	a, _, err := s.SignUp(ctx, "set@example.com", "Set", pw, "x")
	if err != nil {
		t.Fatal(err)
	}
	b, _, err := s.SignUp(ctx, "set2@example.com", "Set2", pw, "x")
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.GetSettings(ctx, a.ID)
	if err != nil || !got.HasPassword || got.TwoStep || !got.LoginAlerts || string(got.Prefs) != "{}" || len(got.Identities) != 0 {
		t.Fatalf("defaults: %v %+v", err, got)
	}
	got, err = s.UpdateSettings(ctx, a.ID, accounts.SettingsChange{Name: ptr("Tolu Bakare"), Username: ptr("@Tolu.B"),
		Prefs: map[string]any{"quality": "1080p", "n.orders.sms": true, "messages": "friends"}})
	if err != nil || got.Username != "tolu.b" {
		t.Fatalf("update: %v %+v", err, got)
	}
	got, err = s.UpdateSettings(ctx, a.ID, accounts.SettingsChange{Prefs: map[string]any{"quality": "4k"}})
	if err != nil || string(got.Prefs) != `{"quality": "4k", "messages": "friends", "n.orders.sms": true}` {
		t.Fatalf("merge: %v %s", err, got.Prefs)
	}
	for _, bad := range []map[string]any{{"quality": "8k"}, {"evil": true}, {"n.orders.fax": true}, {"volumeBoost": "yes"}} {
		if _, err := s.UpdateSettings(ctx, a.ID, accounts.SettingsChange{Prefs: bad}); !errors.Is(err, accounts.ErrBadInput) {
			t.Fatalf("bad pref %v: %v", bad, err)
		}
	}
	if _, err := s.UpdateSettings(ctx, b.ID, accounts.SettingsChange{Username: ptr("tolu.b")}); !errors.Is(err, accounts.ErrUsernameTaken) {
		t.Fatalf("taken: %v", err)
	}
	if _, err := s.UpdateSettings(ctx, b.ID, accounts.SettingsChange{Username: ptr("no")}); !errors.Is(err, accounts.ErrBadInput) {
		t.Fatalf("short username: %v", err)
	}

	// Changing the password needs the current one and sets the date.
	if err := s.ChangePassword(ctx, a.ID, "wrong", "a-long-new-password"); !errors.Is(err, accounts.ErrWrongPassword) {
		t.Fatalf("wrong current: %v", err)
	}
	if err := s.ChangePassword(ctx, a.ID, pw, pw); !errors.Is(err, accounts.ErrReusedPass) {
		t.Fatalf("reuse: %v", err)
	}
	if err := s.ChangePassword(ctx, a.ID, pw, "a-long-new-password"); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.GetSettings(ctx, a.ID); got.PasswordChangedAt == nil {
		t.Fatal("no change date")
	}

	// Two-step: the right password asks for a code; a code signs in.
	if _, err := s.UpdateSettings(ctx, a.ID, accounts.SettingsChange{TwoStep: ptr(true)}); err != nil {
		t.Fatal(err)
	}
	s.SMS = nil
	if _, _, err := s.SignIn(ctx, "set@example.com", "a-long-new-password", "x"); !errors.Is(err, accounts.ErrSecondStep) {
		t.Fatalf("second step: %v", err)
	}
	if _, _, err := s.SignIn(ctx, "set@example.com", "nope", "x"); !errors.Is(err, accounts.ErrBadLogin) {
		t.Fatalf("wrong password with two-step: %v", err)
	}
	code, err := s.IssueCode(ctx, "set@example.com", "login")
	if err != nil {
		t.Fatal(err)
	}
	if _, sess, err := s.SignInWithCode(ctx, "set@example.com", code.Code, "New Phone"); err != nil || !sess.Alert {
		t.Fatalf("code sign in: %v %+v", err, sess)
	}

	// Delete: scheduled, signed out everywhere, cancelled by signing in.
	if _, err := s.ScheduleDelete(ctx, b.ID); err != nil {
		t.Fatal(err)
	}
	_, sess, err := s.SignIn(ctx, "set2@example.com", pw, "x")
	if err != nil || !sess.Restored || sess.Alert {
		t.Fatalf("restore: %v %+v", err, sess)
	}
	if _, err := s.ScheduleDelete(ctx, b.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec(ctx, `UPDATE accounts SET delete_after = now() - interval '1 minute' WHERE id = $1`, b.ID); err != nil {
		t.Fatal(err)
	}
	if n, err := s.PurgeDeleted(ctx); err != nil || n != 1 {
		t.Fatalf("purge: %v %d", err, n)
	}

	// Export carries the account and its devices.
	out, err := s.Export(ctx, a.ID)
	if err != nil || out["account"].(map[string]any)["username"] != "tolu.b" || len(out["devices"].([]any)) < 2 {
		t.Fatalf("export: %v %v", err, out)
	}
	// The only sign-in method cannot be removed.
	if _, err := s.DB.Exec(ctx, `INSERT INTO account_identities (provider, subject, account_id, email) VALUES ('google', 'g1', $1, 'set@example.com')`, a.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.RemoveIdentity(ctx, a.ID, "google"); err != nil {
		t.Fatalf("remove google with password: %v", err)
	}
}
