package accounts_test

import (
	"context"
	"errors"
	"os"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
	"github.com/Bolajiomo99/E-Cinema/api/internal/db"
)

type fakeSMS struct {
	mu   sync.Mutex
	last string
}

func (f *fakeSMS) Send(_ context.Context, to, text string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.last = text
	return nil
}

func (f *fakeSMS) code() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return regexp.MustCompile(`\d{6}`).FindString(f.last)
}

func store(t *testing.T) (accounts.Store, *fakeSMS) {
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
	if _, err := pool.Exec(ctx, `DELETE FROM room_messages; UPDATE holds SET account_id = NULL; DELETE FROM accounts; DELETE FROM sign_in_failures`); err != nil {
		t.Fatal(err)
	}
	sms := &fakeSMS{}
	return accounts.Store{DB: pool, SMS: sms}, sms
}

const pw = "correct horse battery"

func TestSignUpAndIn(t *testing.T) {
	s, _ := store(t)
	ctx := context.Background()
	a, sess, err := s.SignUp(ctx, " Ada@Example.com ", "Ada", pw, "Laptop")
	if err != nil {
		t.Fatal(err)
	}
	if a.Email != "ada@example.com" || sess.Token == "" {
		t.Fatalf("got %+v %+v", a, sess)
	}
	if _, _, err := s.SignUp(ctx, "ada@example.com", "Ada 2", pw, "x"); !errors.Is(err, accounts.ErrEmailTaken) {
		t.Fatalf("duplicate email: %v", err)
	}
	if _, _, err := s.SignUp(ctx, "b@example.com", "B", "short", "x"); !errors.Is(err, accounts.ErrBadInput) {
		t.Fatalf("short password: %v", err)
	}
	if _, _, err := s.SignIn(ctx, "ada@example.com", "wrong password!", "x"); !errors.Is(err, accounts.ErrBadLogin) {
		t.Fatalf("wrong password: %v", err)
	}
	if _, _, err := s.SignIn(ctx, "nobody@example.com", pw, "x"); !errors.Is(err, accounts.ErrBadLogin) {
		t.Fatalf("unknown email: %v", err)
	}
	got, _, err := s.Authenticate(ctx, sess.Token)
	if err != nil || got.ID != a.ID {
		t.Fatalf("authenticate: %v %+v", err, got)
	}
	if err := s.SignOut(ctx, sess.Token); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Authenticate(ctx, sess.Token); !errors.Is(err, accounts.ErrNoSession) {
		t.Fatalf("after sign out: %v", err)
	}
}

func TestDeviceLimit(t *testing.T) {
	s, _ := store(t)
	ctx := context.Background()
	_, first, err := s.SignUp(ctx, "dev@example.com", "Dev", pw, "Phone")
	if err != nil {
		t.Fatal(err)
	}
	_, second, err := s.SignIn(ctx, "dev@example.com", pw, "Laptop")
	if err != nil || second.SignedOut != 0 {
		t.Fatalf("second device: %v %+v", err, second)
	}
	// Mark the second device as recently used so the first is the oldest.
	if _, _, err := s.Authenticate(ctx, second.Token); err != nil {
		t.Fatal(err)
	}
	_, third, err := s.SignIn(ctx, "dev@example.com", pw, "TV")
	if err != nil || third.SignedOut != 1 {
		t.Fatalf("third device: %v %+v", err, third)
	}
	if _, _, err := s.Authenticate(ctx, first.Token); !errors.Is(err, accounts.ErrNoSession) {
		t.Fatalf("oldest device should be signed out: %v", err)
	}
	a, sid, err := s.Authenticate(ctx, third.Token)
	if err != nil {
		t.Fatal(err)
	}
	list, err := s.Devices(ctx, a.ID, sid)
	if err != nil || len(list) != accounts.MaxDevices {
		t.Fatalf("devices: %v %+v", err, list)
	}
	for _, d := range list {
		if d.Device == "Laptop" {
			if err := s.SignOutDevice(ctx, a.ID, d.ID); err != nil {
				t.Fatal(err)
			}
		}
	}
	if _, _, err := s.Authenticate(ctx, second.Token); !errors.Is(err, accounts.ErrNoSession) {
		t.Fatalf("signed-out device still works: %v", err)
	}
}

func TestConcurrentSignInsRespectLimit(t *testing.T) {
	s, _ := store(t)
	ctx := context.Background()
	a, _, err := s.SignUp(ctx, "race@example.com", "Race", pw, "first")
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, _, err := s.SignIn(ctx, "race@example.com", pw, "d"); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	list, err := s.Devices(ctx, a.ID, "")
	if err != nil || len(list) != accounts.MaxDevices {
		t.Fatalf("want %d live devices, got %d (%v)", accounts.MaxDevices, len(list), err)
	}
}

func TestLockout(t *testing.T) {
	s, _ := store(t)
	ctx := context.Background()
	if _, _, err := s.SignUp(ctx, "lock@example.com", "Lock", pw, "x"); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 10; i++ {
		s.SignIn(ctx, "lock@example.com", "wrong password!", "x")
	}
	if _, _, err := s.SignIn(ctx, "lock@example.com", pw, "x"); !errors.Is(err, accounts.ErrLocked) {
		t.Fatalf("want locked, got %v", err)
	}
}

func TestPhoneCheck(t *testing.T) {
	s, sms := store(t)
	ctx := context.Background()
	a, _, err := s.SignUp(ctx, "p1@example.com", "P1", pw, "x")
	if err != nil {
		t.Fatal(err)
	}
	sent, err := s.StartPhoneCheck(ctx, a.ID, "0803 555 0142")
	if err != nil || sent != "+2348035550142" {
		t.Fatalf("start: %v %q", err, sent)
	}
	if _, err := s.StartPhoneCheck(ctx, a.ID, "+2348035550142"); !errors.Is(err, accounts.ErrTooSoon) {
		t.Fatalf("resend: %v", err)
	}
	if _, err := s.ConfirmPhone(ctx, a.ID, "000000x"); !errors.Is(err, accounts.ErrBadCode) {
		t.Fatalf("bad code: %v", err)
	}
	got, err := s.ConfirmPhone(ctx, a.ID, sms.code())
	if err != nil || !got.PhoneVerified || got.Phone != "+2348035550142" {
		t.Fatalf("confirm: %v %+v", err, got)
	}

	// The same phone cannot verify a second account.
	b, _, err := s.SignUp(ctx, "p2@example.com", "P2", pw, "x")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.StartPhoneCheck(ctx, b.ID, "+2348035550142"); !errors.Is(err, accounts.ErrPhoneTaken) {
		t.Fatalf("duplicate phone: %v", err)
	}
}

func TestCodeAttemptsRunOut(t *testing.T) {
	s, sms := store(t)
	ctx := context.Background()
	a, _, _ := s.SignUp(ctx, "p3@example.com", "P3", pw, "x")
	if _, err := s.StartPhoneCheck(ctx, a.ID, "+447700900123"); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5; i++ {
		s.ConfirmPhone(ctx, a.ID, "999999a")
	}
	if _, err := s.ConfirmPhone(ctx, a.ID, sms.code()); !errors.Is(err, accounts.ErrBadCode) {
		t.Fatalf("code should be dead after 5 wrong tries: %v", err)
	}
}

func TestNoSMS(t *testing.T) {
	s, _ := store(t)
	s.SMS = nil
	ctx := context.Background()
	a, _, _ := s.SignUp(ctx, "p4@example.com", "P4", pw, "x")
	if _, err := s.StartPhoneCheck(ctx, a.ID, "+2348035550199"); !errors.Is(err, accounts.ErrSMSUnavailable) {
		t.Fatalf("want unavailable, got %v", err)
	}
	if _, ok := accounts.NormalizePhone("12345"); ok {
		t.Fatal("short number accepted")
	}
	if p, _ := accounts.NormalizePhone("0044 7700 900123"); !strings.HasPrefix(p, "+44") {
		t.Fatal(p)
	}
}

func TestRecordIdentity(t *testing.T) {
	s, _ := store(t)
	ctx := context.Background()
	a, _, _ := s.SignUp(ctx, "id@example.com", "Id", pw, "x")
	got, err := s.RecordIdentity(ctx, a.ID, "pending")
	if err != nil || got.FaceVerified {
		t.Fatalf("pending: %v %+v", err, got)
	}
	got, err = s.RecordIdentity(ctx, a.ID, "approved")
	if err != nil || !got.FaceVerified || !got.IDVerified {
		t.Fatalf("approved: %v %+v", err, got)
	}
}

func TestSignInExternal(t *testing.T) {
	s, _ := store(t)
	ctx := context.Background()
	// New Google user gets an account.
	a, sess, created, err := s.SignInExternal(ctx, "google", "g-1", "New@Example.com", true, "New Person", "Phone")
	if err != nil || !created || a.Email != "new@example.com" || sess.Token == "" {
		t.Fatalf("new: %v %v %+v", err, created, a)
	}
	// Same Google user signs in again to the same account.
	b, _, created, err := s.SignInExternal(ctx, "google", "g-1", "other@example.com", true, "", "Laptop")
	if err != nil || created || b.ID != a.ID {
		t.Fatalf("repeat: %v %v %+v", err, created, b)
	}
	// Google accounts have no password.
	if _, _, err := s.SignIn(ctx, "new@example.com", "!external", "x"); !errors.Is(err, accounts.ErrBadLogin) {
		t.Fatalf("password sign-in on external account: %v", err)
	}
	// An Apple identity with the same verified email links to the existing account.
	pwAcct, _, _ := s.SignUp(ctx, "link@example.com", "Link", pw, "x")
	c, _, created, err := s.SignInExternal(ctx, "apple", "a-1", "link@example.com", true, "", "iPhone")
	if err != nil || created || c.ID != pwAcct.ID {
		t.Fatalf("link: %v %v %+v", err, created, c)
	}
	if _, _, _, err := s.SignInExternal(ctx, "google", "g-2", "x@example.com", false, "", "x"); !errors.Is(err, accounts.ErrBadInput) {
		t.Fatalf("unverified email: %v", err)
	}
}

func TestProfileAndPlan(t *testing.T) {
	s, _ := store(t)
	ctx := context.Background()
	a, _, _ := s.SignUp(ctx, "prof@example.com", "Prof", pw, "x")
	now := time.Date(2026, 10, 31, 0, 0, 0, 0, time.UTC)
	p, err := s.SaveProfile(ctx, a.ID, accounts.Profile{Country: "ng", BirthDate: "1998-03-14", Gender: "female", AppLanguage: "en", AudioLanguage: "yo", ContactPhone: "0803 555 0142"}, now)
	if err != nil || p.Country != "NG" || p.ContactPhone != "+2348035550142" || p.Plan != "free" || p.PlanStatus != "active" {
		t.Fatalf("save: %v %+v", err, p)
	}
	if _, err := s.SaveProfile(ctx, a.ID, accounts.Profile{BirthDate: "2015-01-01"}, now); !errors.Is(err, accounts.ErrBadInput) {
		t.Fatalf("under 13: %v", err)
	}
	if _, err := s.SaveProfile(ctx, a.ID, accounts.Profile{Country: "Nigeria"}, now); !errors.Is(err, accounts.ErrBadInput) {
		t.Fatalf("bad country: %v", err)
	}
	p, err = s.ChoosePlan(ctx, a.ID, "pro")
	if err != nil || p.Plan != "pro" || p.PlanStatus != "awaiting_payment" || p.AudioLanguage != "yo" {
		t.Fatalf("plan: %v %+v", err, p)
	}
	if _, err := s.ChoosePlan(ctx, a.ID, "gold"); !errors.Is(err, accounts.ErrBadInput) {
		t.Fatalf("bad plan: %v", err)
	}
}
