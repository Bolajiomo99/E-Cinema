package studios_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/db"
	"github.com/Bolajiomo99/E-Cinema/api/internal/studios"
	"github.com/jackc/pgx/v5/pgxpool"
)

func pool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	p, err := db.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(p.Close)
	if err := db.Migrate(ctx, p); err != nil {
		t.Fatal(err)
	}
	return p
}

func account(t *testing.T, p *pgxpool.Pool, email, name, country string) string {
	t.Helper()
	var id string
	if err := p.QueryRow(context.Background(), `INSERT INTO accounts (email, name, password_hash, country) VALUES ($1, $2, '!', $3)
	  ON CONFLICT (email) DO UPDATE SET name = $2, country = $3 RETURNING id`, email, name, country).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestOnboardingAndTeam(t *testing.T) {
	p := pool(t)
	ctx := context.Background()
	st := studios.Store{DB: p}
	clean := func() {
		p.Exec(ctx, `DELETE FROM studio_members WHERE studio LIKE 'Test Reel%'`)
		p.Exec(ctx, `DELETE FROM studios WHERE name LIKE 'Test Reel%'`)
	}
	clean()
	t.Cleanup(clean)
	owner := account(t, p, "st-owner@example.com", "Folake Adeyemi", "NG")
	other := account(t, p, "st-fin@example.com", "Kemi Bello", "NG")

	if _, err := st.Mine(ctx, owner, "st-owner@example.com"); !errors.Is(err, studios.ErrNotFound) {
		t.Fatalf("no studio yet: %v", err)
	}
	if _, err := st.Save(ctx, owner, "st-owner@example.com", studios.Draft{Name: "Lagoon Gate Pictures", RegCountry: "NG"}); !errors.Is(err, studios.ErrNameTaken) {
		t.Fatalf("taken name: %v", err)
	}
	s, err := st.Save(ctx, owner, "st-owner@example.com", studios.Draft{Name: "Test Reel Films", RegCountry: "ng", RegNumber: "RC 1"})
	if err != nil || s.Role != "owner" || s.Status != "draft" || s.Slug != "test-reel-films" || s.RegCountry != "NG" {
		t.Fatalf("save: %+v %v", s, err)
	}
	if s, err = st.Save(ctx, owner, "st-owner@example.com", studios.Draft{Name: "Test Reel Studios", RegCountry: "NG"}); err != nil || s.Name != "Test Reel Studios" {
		t.Fatalf("rename draft: %+v %v", s, err)
	}
	if _, err := st.Submit(ctx, owner, "st-owner@example.com"); !errors.Is(err, studios.ErrIncomplete) {
		t.Fatalf("submit early: %v", err)
	}
	if _, err := st.SetDocs(ctx, owner, "st-owner@example.com", "elsewhere/x.pdf", true); !errors.Is(err, studios.ErrBadInput) {
		t.Fatalf("bad doc key: %v", err)
	}
	if _, err := st.SetDocs(ctx, owner, "st-owner@example.com", "studios/test/cac.pdf", true); err != nil {
		t.Fatal(err)
	}
	if _, err := st.SetPayout(ctx, owner, "st-owner@example.com", studios.Payout{Method: "paypal", Email: "not-an-email"}); !errors.Is(err, studios.ErrBadInput) {
		t.Fatalf("bad payout: %v", err)
	}
	if _, err := st.SetPayout(ctx, owner, "st-owner@example.com", studios.Payout{Method: "paypal", Email: "Money@TestReel.example.com"}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.DeclareRights(ctx, owner, "st-owner@example.com", "short"); !errors.Is(err, studios.ErrBadInput) {
		t.Fatalf("short rights: %v", err)
	}
	if _, err := st.DeclareRights(ctx, owner, "st-owner@example.com", "Worldwide rights to Orbit Zero for 2026 to 2031, all languages."); err != nil {
		t.Fatal(err)
	}
	if _, err := st.AcceptTerms(ctx, owner, "st-owner@example.com"); err != nil {
		t.Fatal(err)
	}
	if s, err = st.Submit(ctx, owner, "st-owner@example.com"); err != nil || s.Status != "submitted" {
		t.Fatalf("submit: %+v %v", s, err)
	}
	if _, err := st.DeclareRights(ctx, owner, "st-owner@example.com", "Changing my mind about these rights after submit."); !errors.Is(err, studios.ErrLocked) {
		t.Fatalf("locked: %v", err)
	}
	if err := st.Review(ctx, "test-reel-studios", false, ""); !errors.Is(err, studios.ErrBadInput) {
		t.Fatalf("reject needs a note: %v", err)
	}
	if err := st.Review(ctx, "test-reel-studios", true, ""); err != nil {
		t.Fatal(err)
	}
	if s, _ = st.Mine(ctx, owner, "st-owner@example.com"); s.Status != "verified" || s.VerifiedAt == nil {
		t.Fatalf("verified: %+v", s)
	}

	// Team: invite by email, claimed on first sign-in; roles limit what each can do.
	if err := st.SetMember(ctx, owner, "st-owner@example.com", "ST-FIN@example.com", "finance"); err != nil {
		t.Fatal(err)
	}
	if s, err := st.Mine(ctx, other, "st-fin@example.com"); err != nil || s.Role != "finance" {
		t.Fatalf("invite claimed: %+v %v", s, err)
	}
	if err := st.SetMember(ctx, other, "st-fin@example.com", "x@example.com", "viewer"); !errors.Is(err, studios.ErrForbidden) {
		t.Fatalf("finance cannot invite: %v", err)
	}
	if _, _, err := st.Payouts(ctx, other, "st-fin@example.com"); err != nil {
		t.Fatalf("finance sees payouts: %v", err)
	}
	// An admin cannot demote an owner.
	if err := st.SetMember(ctx, owner, "st-owner@example.com", "st-fin@example.com", "admin"); err != nil {
		t.Fatal(err)
	}
	if err := st.SetMember(ctx, other, "st-fin@example.com", "st-owner@example.com", "viewer"); !errors.Is(err, studios.ErrForbidden) {
		t.Fatalf("admin demoted the owner: %v", err)
	}
	if err := st.SetMember(ctx, owner, "st-owner@example.com", "st-fin@example.com", "finance"); err != nil {
		t.Fatal(err)
	}
	// One studio per person.
	st.DB.Exec(ctx, `INSERT INTO studios (name, payout_email, slug) VALUES ('Test Other Studio', 'x@example.com', 'test-other-studio') ON CONFLICT DO NOTHING`)
	st.DB.Exec(ctx, `INSERT INTO studio_members (studio, email, role) VALUES ('Test Other Studio', 'st-elsewhere@example.com', 'owner') ON CONFLICT DO NOTHING`)
	defer st.DB.Exec(ctx, `DELETE FROM studios WHERE name = 'Test Other Studio'`)
	if err := st.SetMember(ctx, owner, "st-owner@example.com", "st-elsewhere@example.com", "viewer"); !errors.Is(err, studios.ErrTaken) {
		t.Fatalf("person in two studios: %v", err)
	}
	if err := st.RemoveMember(ctx, owner, "st-owner@example.com", "st-owner@example.com"); !errors.Is(err, studios.ErrLastOwner) {
		t.Fatalf("last owner: %v", err)
	}
	team, err := st.Team(ctx, owner, "st-owner@example.com")
	if err != nil || len(team) != 2 || team[0].Role != "owner" || !team[0].Me || !team[1].Joined {
		t.Fatalf("team: %+v %v", team, err)
	}
}

func TestOverviewNumbers(t *testing.T) {
	p := pool(t)
	ctx := context.Background()
	st := studios.Store{DB: p}
	const studio = "Test Reel Numbers"
	clean := func() {
		p.Exec(ctx, `DELETE FROM reviews WHERE showtime_id LIKE 'test-reel-%'`)
		p.Exec(ctx, `DELETE FROM watch_beats WHERE showtime_id LIKE 'test-reel-%'`)
		p.Exec(ctx, `DELETE FROM holds WHERE showtime_id LIKE 'test-reel-%'`)
		p.Exec(ctx, `DELETE FROM showtimes WHERE id LIKE 'test-reel-%'`)
		p.Exec(ctx, `DELETE FROM studio_members WHERE studio = $1`, studio)
		p.Exec(ctx, `DELETE FROM studios WHERE name = $1`, studio)
	}
	clean()
	t.Cleanup(clean)
	owner := account(t, p, "st-num@example.com", "Ada Obi", "NG")
	gh := account(t, p, "st-num-gh@example.com", "Kofi Mensah", "GH")
	if _, err := p.Exec(ctx, `INSERT INTO studios (name, payout_email, slug) VALUES ($1, 'pay@example.com', 'test-reel-numbers')`, studio); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, `INSERT INTO studio_members (studio, email, account_id, role) VALUES ($1, 'st-num@example.com', $2, 'owner')`, studio, owner); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	for _, s := range []struct {
		id    string
		start time.Time
	}{{"test-reel-past", now.Add(-48 * time.Hour)}, {"test-reel-next", now.Add(24 * time.Hour)}} {
		if _, err := p.Exec(ctx, `INSERT INTO showtimes (id, film, studio, starts_at, duration_min, capacity, price_cents, currency) VALUES ($1, $1, $2, $3, 100, 10, 1000, 'USD')`, s.id, studio, s.start); err != nil {
			t.Fatal(err)
		}
	}
	for i, a := range []string{owner, gh, gh} {
		if _, err := p.Exec(ctx, `INSERT INTO holds (showtime_id, seats, viewer_ref, status, expires_at, account_id, paypal_order_id) VALUES ($1, 1, 'v', 'paid', now(), $2, $3)`,
			"test-reel-past", a, "TR-"+string(rune('a'+i))+now.Format("150405.000")); err != nil {
			t.Fatal(err)
		}
	}
	p.Exec(ctx, `INSERT INTO holds (showtime_id, seats, viewer_ref, status, expires_at, account_id, paypal_order_id) VALUES ('test-reel-next', 9, 'v', 'paid', now(), $1, $2)`, owner, "TR-n"+now.Format("150405.000"))
	p.Exec(ctx, `INSERT INTO reviews (account_id, showtime_id, stars) VALUES ($1, 'test-reel-past', 5), ($2, 'test-reel-past', 4)`, owner, gh)
	p.Exec(ctx, `INSERT INTO watch_beats (account_id, showtime_id, day, mode, seconds) VALUES ($1, 'test-reel-past', current_date, 'room', 6000), ($2, 'test-reel-past', current_date, 'room', 3000)`, owner, gh)

	o, err := st.Overview(ctx, owner, "st-num@example.com", now)
	if err != nil {
		t.Fatal(err)
	}
	// 12 seats x $10 = $120 gross this month; studio keeps 70% = $84.
	if o.SeatsMonth != 12 || o.EarnedMonth != 8400 || o.Countries != 2 || o.Rating != 4.5 || o.Reviews != 2 {
		t.Fatalf("totals: %+v", o)
	}
	if o.Completion < 0.74 || o.Completion > 0.76 {
		t.Fatalf("completion %.3f, want 0.75", o.Completion)
	}
	if len(o.Months) != 12 || o.Months[11].GrossCents != 12000 {
		t.Fatalf("months: %+v", o.Months)
	}
	if len(o.Coming) != 1 || o.Coming[0].Seats != 9 || o.OwedCents != 2100 {
		t.Fatalf("coming/owed: %+v owed %d", o.Coming, o.OwedCents)
	}
	if len(o.Notes) == 0 || o.Notes[0].Kind != "seats" {
		t.Fatalf("notes: %+v", o.Notes)
	}
	films, err := st.Films(ctx, owner, "st-num@example.com")
	if err != nil || len(films) != 2 || films[1].State != "ended" || films[1].ShareCents != 2100 || films[1].Countries != 2 {
		t.Fatalf("films: %+v %v", films, err)
	}
}
