package accounts_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
)

func TestFamily(t *testing.T) {
	st, _ := store(t)
	p := st.DB
	ctx := context.Background()
	var id string
	if err := p.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash) VALUES ('family-owner@example.com', 'Bolaji', '!')
	  ON CONFLICT (email) DO UPDATE SET parent_pin_hash = NULL, parent_pin_tries = 0, parent_pin_paused_until = NULL RETURNING id`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	p.Exec(ctx, `DELETE FROM profiles WHERE account_id = $1`, id)
	t.Cleanup(func() { p.Exec(ctx, `DELETE FROM accounts WHERE id = $1`, id) })

	kids := accounts.Member{Name: "Ada", Kind: "kids", Age: 8, MaxRating: "18", Chat: false, AskToBuy: true, ScreenMinutes: 120, Bedtime: "20:00"}
	if _, err := st.AddProfile(ctx, id, kids); !errors.Is(err, accounts.ErrNeedParentPIN) {
		t.Fatalf("kids before PIN: %v", err)
	}
	if err := st.SetParentPIN(ctx, id, "", "12a4"); !errors.Is(err, accounts.ErrBadInput) {
		t.Fatalf("bad pin: %v", err)
	}
	if err := st.SetParentPIN(ctx, id, "", "4821"); err != nil {
		t.Fatal(err)
	}
	if err := st.SetParentPIN(ctx, id, "0000", "1111"); !errors.Is(err, accounts.ErrBadParentPIN) {
		t.Fatalf("replace with wrong pin: %v", err)
	}
	ada, err := st.AddProfile(ctx, id, kids)
	if err != nil || ada.MaxRating != "16" || ada.Chat || !ada.AskToBuy {
		t.Fatalf("ada = %+v, %v", ada, err)
	}
	if _, err := st.AddProfile(ctx, id, accounts.Member{Name: "Tolu", Kind: "adult"}); err != nil {
		t.Fatal(err)
	}
	for _, n := range []string{"Femi", "Kemi", "Dayo"} {
		if _, err := st.AddProfile(ctx, id, accounts.Member{Name: n, Kind: "kids", Age: 12, MaxRating: "12"}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := st.AddProfile(ctx, id, accounts.Member{Name: "Seventh", Kind: "adult"}); !errors.Is(err, accounts.ErrTooManyProfiles) {
		t.Fatalf("seventh: %v", err)
	}
	f, err := st.Family(ctx, id)
	if err != nil || len(f.Profiles) != 6 || f.Profiles[0].Kind != "owner" || !f.PINSet {
		t.Fatalf("family = %+v, %v", f, err)
	}
	if _, err := st.ProfileFor(ctx, "00000000-0000-0000-0000-000000000000", ada.ID); !errors.Is(err, accounts.ErrNotFound) {
		t.Fatalf("other account's profile: %v", err)
	}

	// Ratings.
	for _, c := range []struct {
		r, max string
		ok     bool
	}{{"G", "all", true}, {"PG", "all", false}, {"PG", "7", true}, {"PG-13", "12", true}, {"18+", "16", false}, {"18+", "18", true}, {"X", "16", false}} {
		if accounts.Allowed(c.r, c.max) != c.ok {
			t.Errorf("Allowed(%s, %s) != %v", c.r, c.max, c.ok)
		}
	}

	// Bedtime and screen time.
	lagos := time.FixedZone("WAT", 3600)
	if err := accounts.CanWatch(ada, time.Date(2026, 11, 1, 19, 0, 0, 0, lagos)); err != nil {
		t.Fatal(err)
	}
	if err := accounts.CanWatch(ada, time.Date(2026, 11, 1, 20, 30, 0, 0, lagos)); !errors.Is(err, accounts.ErrBedtime) {
		t.Fatalf("bedtime: %v", err)
	}
	for range 60 {
		st.AddWatch(ctx, ada.ID, 120)
	}
	ada, _ = st.ProfileFor(ctx, id, ada.ID)
	if err := accounts.CanWatch(ada, time.Date(2026, 11, 1, 10, 0, 0, 0, lagos)); !errors.Is(err, accounts.ErrScreenTime) {
		t.Fatalf("screen time: %v (%d s)", err, ada.WatchedToday)
	}

	// Purchase requests.
	r, err := st.AskParent(ctx, id, ada.ID, "Moonlight Fox ticket", "/book/moonlight-fox")
	if err != nil || r.Status != "pending" || r.Member != "Ada" {
		t.Fatalf("ask = %+v, %v", r, err)
	}
	if _, err := st.AskParent(ctx, id, ada.ID, "x", "//evil.example"); !errors.Is(err, accounts.ErrBadInput) {
		t.Fatalf("bad link: %v", err)
	}
	if err := st.DecideRequest(ctx, id, r.ID, true); err != nil {
		t.Fatal(err)
	}
	if err := st.DecideRequest(ctx, id, r.ID, false); !errors.Is(err, accounts.ErrNotFound) {
		t.Fatalf("decide twice: %v", err)
	}

	// Wrong PINs pause after five tries (one was spent replacing the PIN above).
	for i := 0; i < 3; i++ {
		if err := st.CheckParentPIN(ctx, id, "9999"); !errors.Is(err, accounts.ErrBadParentPIN) {
			t.Fatalf("try %d: %v", i, err)
		}
	}
	if err := st.CheckParentPIN(ctx, id, "9999"); !errors.Is(err, accounts.ErrParentPaused) {
		t.Fatalf("fifth: %v", err)
	}
	if err := st.CheckParentPIN(ctx, id, "4821"); !errors.Is(err, accounts.ErrParentPaused) {
		t.Fatalf("paused right pin: %v", err)
	}
}
