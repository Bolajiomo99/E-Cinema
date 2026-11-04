package exec_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/db"
	"github.com/Bolajiomo99/E-Cinema/api/internal/exec"
)

func TestRolesAndCommand(t *testing.T) {
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
	p.Exec(ctx, `DELETE FROM executives WHERE email LIKE 'ex-%@example.com'`)
	t.Cleanup(func() { p.Exec(ctx, `DELETE FROM executives WHERE email LIKE 'ex-%@example.com'`) })
	p.Exec(ctx, `INSERT INTO executives (email, role) VALUES ('ex-cfo@example.com', 'cfo'), ('ex-inv@example.com', 'investor')`)
	st := exec.Store{DB: p, CEOs: []string{"ex-ceo@example.com"}}

	for email, want := range map[string]string{"EX-CEO@example.com": "ceo", "ex-cfo@example.com": "cfo", "ex-inv@example.com": "investor", "ex-nobody@example.com": ""} {
		if got, err := st.Role(ctx, email); err != nil || got != want {
			t.Fatalf("role %s = %q %v, want %q", email, got, err, want)
		}
	}
	c, err := st.Command(ctx, "ex-ceo@example.com", time.Now())
	if err != nil || len(c.Months) != 12 {
		t.Fatalf("ceo command: %+v %v", c, err)
	}
	if _, err := st.Command(ctx, "ex-cfo@example.com", time.Now()); err != nil {
		t.Fatalf("cfo: %v", err)
	}
	for _, e := range []string{"ex-inv@example.com", "ex-nobody@example.com"} {
		if _, err := st.Command(ctx, e, time.Now()); !errors.Is(err, exec.ErrForbidden) {
			t.Fatalf("%s should be forbidden, got %v", e, err)
		}
	}
}

func TestAccess(t *testing.T) {
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
	clean := func() { p.Exec(ctx, `DELETE FROM executives WHERE email LIKE 'ax-%@example.com'`) }
	clean()
	t.Cleanup(clean)
	st := exec.Store{DB: p, CEOs: []string{"ax-ceo@example.com"}}
	now := time.Now()
	if _, err := st.Grant(ctx, "ax-cfo@example.com", "", exec.Grant{Email: "ax-x@example.com", Role: "investor"}, now); !errors.Is(err, exec.ErrForbidden) {
		t.Fatalf("non-CEO grant: %v", err)
	}
	for _, g := range []exec.Grant{{Email: "nope", Role: "cfo"}, {Email: "ax-ceo@example.com", Role: "cfo"}, {Email: "ax-a@example.com", Role: "ceo"}, {Email: "ax-a@example.com", Role: "boss"}, {Email: "ax-a@example.com", Role: "cfo", ExpiresOn: "2001-01-01"}} {
		if _, err := st.Grant(ctx, "ax-ceo@example.com", "", g, now); !errors.Is(err, exec.ErrBadInput) {
			t.Fatalf("grant %+v: %v", g, err)
		}
	}
	added, err := st.Grant(ctx, "AX-CEO@example.com", "", exec.Grant{Email: " AX-Inv@Example.com ", Name: "Ngozi Eze", Org: "Helios Fund", Role: "investor", Scopes: []string{"growth", "revenue", "growth", "bogus"}, ExpiresOn: now.AddDate(0, 1, 0).Format("2006-01-02")}, now)
	if err != nil || !added {
		t.Fatalf("grant: %v %v", added, err)
	}
	p.Exec(ctx, `UPDATE executives SET pending = false WHERE email = 'ax-inv@example.com'`) // as if they finished the invite
	if added, err = st.Grant(ctx, "ax-ceo@example.com", "", exec.Grant{Email: "ax-inv@example.com", Role: "stakeholder"}, now); err != nil || added {
		t.Fatalf("change: %v %v", added, err)
	}
	ppl, err := st.People(ctx, "ax-ceo@example.com")
	if err != nil || len(ppl) < 2 || ppl[0].Role != "ceo" {
		t.Fatalf("people: %+v %v", ppl, err)
	}
	var got *exec.Person
	for i := range ppl {
		if ppl[i].Email == "ax-inv@example.com" {
			got = &ppl[i]
		}
	}
	if got == nil || got.Role != "stakeholder" || len(got.Scopes) != 0 || got.ExpiresOn != "" {
		t.Fatalf("changed person: %+v", got)
	}
	if r, _ := st.Role(ctx, "ax-inv@example.com"); r != "stakeholder" {
		t.Fatalf("role %q", r)
	}
	// Expired access stops at once.
	p.Exec(ctx, `UPDATE executives SET expires_on = current_date - 2 WHERE email = 'ax-inv@example.com'`)
	if r, _ := st.Role(ctx, "ax-inv@example.com"); r != "" {
		t.Fatalf("expired role %q", r)
	}
	if err := st.Revoke(ctx, "ax-ceo@example.com", "ax-inv@example.com"); err != nil {
		t.Fatal(err)
	}
	if err := st.Revoke(ctx, "ax-ceo@example.com", "ax-inv@example.com"); !errors.Is(err, exec.ErrNotFound) {
		t.Fatalf("second revoke: %v", err)
	}
}

func TestMoney(t *testing.T) {
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
	clean := func() {
		p.Exec(ctx, `DELETE FROM executives WHERE email LIKE 'mx-%@example.com'`)
		p.Exec(ctx, `DELETE FROM holds WHERE showtime_id = 'test-mx-1'`)
		p.Exec(ctx, `DELETE FROM showtimes WHERE id = 'test-mx-1'`)
	}
	clean()
	t.Cleanup(clean)
	p.Exec(ctx, `INSERT INTO executives (email, role, can_money) VALUES ('mx-cfo@example.com', 'cfo', false), ('mx-coo@example.com', 'coo', false), ('mx-inv@example.com', 'investor', true)`)
	p.Exec(ctx, `INSERT INTO showtimes (id, film, studio, starts_at, duration_min, capacity, price_cents, currency) VALUES ('test-mx-1', 'Orbit Zero', 'Test Studio', now() - interval '1 day', 100, 50, 1000, 'USD')`)
	p.Exec(ctx, `INSERT INTO holds (showtime_id, seats, viewer_ref, status, expires_at, paypal_order_id, net_cents) VALUES
	  ('test-mx-1', 2, 'mx1', 'paid', now(), 'PSK-mx1', 2000), ('test-mx-1', 1, 'mx2', 'refunded', now(), 'FLW-mx2', 1000), ('test-mx-1', 1, 'mx3', 'paid', now(), 'PAYPAL-mx3', NULL),
	  ('test-mx-1', 1, 'mx4', 'released', now(), 'PSK-mx4', NULL)`)
	p.Exec(ctx, `INSERT INTO holds (showtime_id, seats, viewer_ref, status, expires_at, paypal_order_id, paypal_capture_id, net_cents) VALUES ('test-mx-1', 1, 'mx5', 'paid', now(), 'x', 'CREDIT-x', 1000)`)
	st := exec.Store{DB: p, CEOs: []string{"mx-ceo@example.com"}}
	for _, e := range []string{"mx-coo@example.com", "mx-nobody@example.com"} {
		if _, err := st.Money(ctx, e, 30, time.Now()); !errors.Is(err, exec.ErrForbidden) {
			t.Fatalf("%s: %v", e, err)
		}
	}
	for _, e := range []string{"mx-ceo@example.com", "mx-cfo@example.com", "mx-inv@example.com"} {
		if _, err := st.Money(ctx, e, 30, time.Now()); err != nil {
			t.Fatalf("%s: %v", e, err)
		}
	}
	// Our three paid-with-money seats: 2000 + 1000 USD gross; credit seats are not counted again.
	before, _ := st.Money(ctx, "mx-ceo@example.com", 30, time.Now().Add(-time.Hour))
	m, err := st.Money(ctx, "mx-ceo@example.com", 30, time.Now().Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	sum := func(m exec.Money) (g, n int64) {
		for _, r := range m.Rows {
			if r.Source == "tickets" && r.Currency == "USD" && !r.Prev {
				g += r.Gross
				n += r.Net
			}
		}
		return
	}
	g0, n0 := sum(before)
	g1, n1 := sum(m)
	if g1-g0 != 3000 || n1-n0 != 900 {
		t.Fatalf("tickets gross %d net %d (before %d %d)", g1, n1, g0, n0)
	}
	prov := map[string]exec.ProviderRow{}
	for _, x := range m.Providers {
		prov[x.Provider] = x
	}
	if prov["paystack"].Tried < 2 || prov["flutterwave"].Refunded < 1 {
		t.Fatalf("providers %+v", m.Providers)
	}
}

func TestGrowth(t *testing.T) {
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
	clean := func() {
		p.Exec(ctx, `DELETE FROM executives WHERE email LIKE 'gx-%@example.com'`)
		p.Exec(ctx, `DELETE FROM accounts WHERE email LIKE 'gx-%@example.com'`)
	}
	clean()
	t.Cleanup(clean)
	p.Exec(ctx, `INSERT INTO executives (email, role) VALUES ('gx-cmo@example.com', 'cmo'), ('gx-cto@example.com', 'cto')`)
	if _, err := p.Exec(ctx, `INSERT INTO accounts (email, name, password_hash, country, plan, created_at, face_verified_at, phone_verified_at) VALUES
	  ('gx-a@example.com', 'A', '!', 'ZW', 'pro', now() - interval '3 days', now(), now()),
	  ('gx-b@example.com', 'B', '!', 'ZW', 'free', now() - interval '40 days', NULL, NULL),
	  ('gx-c@example.com', 'C', '!', 'ZW', 'free', now() - interval '2 days', NULL, NULL)`); err != nil {
		t.Fatal(err)
	}
	st := exec.Store{DB: p, CEOs: []string{"gx-ceo@example.com"}}
	if _, err := st.Growth(ctx, "gx-cto@example.com", 30, "", time.Now()); !errors.Is(err, exec.ErrForbidden) {
		t.Fatalf("cto: %v", err)
	}
	g, err := st.Growth(ctx, "gx-cmo@example.com", 30, "zw", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if g.Country != "ZW" || g.Members != 3 || g.MembersPrev != 1 || g.NewWeek != 2 || g.Paying != 1 || g.Funnel != [4]int{2, 1, 0, 1} || len(g.Months) != 12 || g.Months[11].GrossCents != 3 {
		t.Fatalf("growth: %+v", g)
	}
	if len(g.Countries) != 1 || g.Countries[0].New != 2 || g.Countries[0].NewPrev != 1 || g.Plans["pro"] != 1 || g.Plans["free"] != 2 {
		t.Fatalf("countries/plans: %+v %+v", g.Countries, g.Plans)
	}
	if len(g.Cohorts) == 0 || len(g.Cohorts[len(g.Cohorts)-1].Weeks) != 5 {
		t.Fatalf("cohorts: %+v", g.Cohorts)
	}
	if _, err := st.Growth(ctx, "gx-ceo@example.com", 7, "", time.Now()); err != nil {
		t.Fatal(err)
	}
}

func TestContent(t *testing.T) {
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
	clean := func() {
		p.Exec(ctx, `DELETE FROM executives WHERE email LIKE 'cx-%@example.com'`)
		p.Exec(ctx, `DELETE FROM showtimes WHERE id LIKE 'test-cx-%'`)
		p.Exec(ctx, `DELETE FROM studios WHERE slug LIKE 'test-cx-%'`)
	}
	clean()
	t.Cleanup(clean)
	p.Exec(ctx, `INSERT INTO executives (email, role) VALUES ('cx-coo@example.com', 'coo'), ('cx-cfo@example.com', 'cfo')`)
	p.Exec(ctx, `INSERT INTO showtimes (id, film, studio, starts_at, duration_min, capacity, price_cents, currency) VALUES
	  ('test-cx-1', 'Test Cx Live', 'Cx Studio', now() - interval '10 minutes', 100, 10, 500, 'USD'),
	  ('test-cx-2', 'Test Cx Soon', 'Cx Studio', now() + interval '5 days', 100, 10, 500, 'USD')`)
	if _, err := p.Exec(ctx, `INSERT INTO studios (name, slug, status, payout_email, docs_ok, rights_at) VALUES ('Cx Ready', 'test-cx-ready', 'submitted', 'a@example.com', true, now()), ('Cx Not', 'test-cx-not', 'submitted', 'b@example.com', false, NULL)`); err != nil {
		t.Fatal(err)
	}
	st := exec.Store{DB: p, CEOs: []string{"cx-ceo@example.com"}}
	if _, err := st.Content(ctx, "cx-cfo@example.com", time.Now()); !errors.Is(err, exec.ErrForbidden) {
		t.Fatalf("cfo: %v", err)
	}
	c, err := st.Content(ctx, "cx-coo@example.com", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	state := map[string]string{}
	for _, f := range c.Films {
		state[f.Film] = f.State
	}
	if state["Test Cx Live"] != "screening" || state["Test Cx Soon"] != "presale" || c.StudiosWaiting < 2 {
		t.Fatalf("content: %+v %d", state, c.StudiosWaiting)
	}
	if err := st.CanDecideStudios(ctx, "cx-cfo@example.com"); !errors.Is(err, exec.ErrForbidden) {
		t.Fatalf("cfo decide: %v", err)
	}
	if ok, err := st.StudioReady(ctx, "test-cx-ready"); !ok || err != nil {
		t.Fatalf("ready: %v %v", ok, err)
	}
	if ok, err := st.StudioReady(ctx, "test-cx-not"); ok || err != nil {
		t.Fatalf("not ready: %v %v", ok, err)
	}
}

func TestShop(t *testing.T) {
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
	clean := func() {
		p.Exec(ctx, `DELETE FROM executives WHERE email LIKE 'sx-%@example.com'`)
		p.Exec(ctx, `DELETE FROM shop_products WHERE id LIKE 'sx-test-%'`)
	}
	clean()
	t.Cleanup(clean)
	p.Exec(ctx, `INSERT INTO executives (email, role, can_add) VALUES ('sx-coo@example.com', 'coo', true), ('sx-cfo@example.com', 'cfo', false)`)
	st := exec.Store{DB: p, CEOs: []string{"sx-ceo@example.com"}}
	in := exec.ProductInput{Name: "Sx Test Lamp", Sub: "Glows", Category: "gear", PriceNGN: 25000, Ships: "ng", ShipDays: 3, Active: false,
		Options: []exec.Option{{Name: "Colour", Values: []string{" Red ", "", "Blue"}}}, Images: []string{"/api/shop/photo/0b7c6c1e-2f4a-4a3a-9a57-1a2b3c4d5e6f.jpg"}}
	if _, err := st.SaveProduct(ctx, "sx-cfo@example.com", in); !errors.Is(err, exec.ErrForbidden) {
		t.Fatalf("cfo: %v", err)
	}
	bad := in
	bad.Images = []string{"https://evil.example/x.jpg"}
	if _, err := st.SaveProduct(ctx, "sx-coo@example.com", bad); !errors.Is(err, exec.ErrBadInput) {
		t.Fatalf("bad image: %v", err)
	}
	id, err := st.SaveProduct(ctx, "sx-coo@example.com", in)
	if err != nil || id != "sx-test-lamp" {
		t.Fatalf("add: %q %v", id, err)
	}
	id2, err := st.SaveProduct(ctx, "sx-ceo@example.com", in)
	if err != nil || id2 != "sx-test-lamp-2" {
		t.Fatalf("second: %q %v", id2, err)
	}
	in.ID, in.Active, in.PriceNGN = id, true, 30000
	if _, err := st.SaveProduct(ctx, "sx-coo@example.com", in); err != nil {
		t.Fatal(err)
	}
	var price int
	var active bool
	var opts string
	p.QueryRow(ctx, `SELECT price_ngn, active, options::text FROM shop_products WHERE id = $1`, id).Scan(&price, &active, &opts)
	if price != 30000 || !active || opts != `[{"name": "Colour", "values": ["Red", "Blue"]}]` {
		t.Fatalf("saved: %d %v %s", price, active, opts)
	}
	sh, err := st.Shop(ctx, "sx-cfo@example.com", time.Now())
	if err != nil || sh.CanAdd || len(sh.Products) < 2 {
		t.Fatalf("shop: %+v %v", sh.CanAdd, err)
	}
}

func TestRooms(t *testing.T) {
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
	clean := func() {
		p.Exec(ctx, `DELETE FROM executives WHERE email LIKE 'rx-%@example.com'`)
		p.Exec(ctx, `DELETE FROM room_types WHERE id LIKE 'rx-%'`)
	}
	clean()
	t.Cleanup(clean)
	p.Exec(ctx, `INSERT INTO executives (email, role, can_add) VALUES ('rx-coo@example.com', 'coo', true), ('rx-cfo@example.com', 'cfo', false), ('rx-cmo@example.com', 'cmo', true)`)
	st := exec.Store{DB: p, CEOs: []string{"rx-ceo@example.com"}}
	if _, err := st.Rooms(ctx, "rx-cmo@example.com", time.Now()); !errors.Is(err, exec.ErrForbidden) {
		t.Fatalf("cmo sees rooms: %v", err)
	}
	r, err := st.Rooms(ctx, "rx-cfo@example.com", time.Now())
	if err != nil || r.CanAdd || len(r.Types) < 5 {
		t.Fatalf("cfo rooms = %+v %v", r, err)
	}
	in := exec.RoomType{Name: "Rx Night Hall", Kind: "vr", Scene: "rooftop", Seats: 300, Audience: "everyone", Voice: true, Live: false}
	if _, err := st.SaveRoom(ctx, "rx-cfo@example.com", in); !errors.Is(err, exec.ErrForbidden) {
		t.Fatalf("cfo adds: %v", err)
	}
	bad := in
	bad.Scene = "lounge"
	if _, err := st.SaveRoom(ctx, "rx-coo@example.com", bad); !errors.Is(err, exec.ErrBadInput) {
		t.Fatalf("vr hall in a lounge: %v", err)
	}
	id, err := st.SaveRoom(ctx, "rx-coo@example.com", in)
	if err != nil || id != "rx-night-hall" {
		t.Fatalf("add = %q %v", id, err)
	}
	var seats int
	var by string
	p.QueryRow(ctx, `SELECT seats, updated_by FROM room_types WHERE id = $1`, id).Scan(&seats, &by)
	if seats != exec.HallSeats || by != "rx-coo@example.com" {
		t.Fatalf("seats %d by %q", seats, by)
	}
	kids := exec.RoomType{Name: "Rx Kids", Kind: "party", Scene: "lounge", Seats: 40, Audience: "kids", Voice: true, Live: true}
	kid, err := st.SaveRoom(ctx, "rx-ceo@example.com", kids)
	if err != nil {
		t.Fatal(err)
	}
	var voice bool
	p.QueryRow(ctx, `SELECT voice FROM room_types WHERE id = $1`, kid).Scan(&voice)
	if voice {
		t.Fatal("kids room kept voice chat")
	}
	in.ID, in.Live = id, true
	if _, err := st.SaveRoom(ctx, "rx-coo@example.com", in); err != nil {
		t.Fatal(err)
	}
	r, _ = st.Rooms(ctx, "rx-ceo@example.com", time.Now())
	if !r.CanAdd || r.UpdatedBy != "rx-coo@example.com" {
		t.Fatalf("after edit = %+v", r)
	}
	in.ID = "rx-missing"
	if _, err := st.SaveRoom(ctx, "rx-coo@example.com", in); !errors.Is(err, exec.ErrNotFound) {
		t.Fatalf("missing: %v", err)
	}
}

func TestSafety(t *testing.T) {
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
	clean := func() {
		p.Exec(ctx, `DELETE FROM executives WHERE email LIKE 'fx-%@example.com'`)
		p.Exec(ctx, `DELETE FROM room_reports WHERE showtime_id = 'fx-show'`)
		p.Exec(ctx, `DELETE FROM room_messages WHERE showtime_id = 'fx-show'`)
		p.Exec(ctx, `DELETE FROM accounts WHERE email LIKE 'fx-%@example.com'`)
		p.Exec(ctx, `DELETE FROM sign_in_failures WHERE email = 'fx-locked@example.com'`)
	}
	clean()
	t.Cleanup(clean)
	p.Exec(ctx, `INSERT INTO executives (email, role) VALUES ('fx-coo@example.com', 'coo'), ('fx-cfo@example.com', 'cfo')`)
	p.Exec(ctx, `INSERT INTO showtimes VALUES ('fx-show', 'Fx Film', 'S', now() - interval '10 minutes', 90, 10, 500, 'USD') ON CONFLICT (id) DO NOTHING`)
	var a, b, c string
	for _, x := range []struct {
		e string
		v *string
	}{{"fx-a@example.com", &a}, {"fx-b@example.com", &b}, {"fx-c@example.com", &c}} {
		if err := p.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash) VALUES ($1, 'Fx', '!') RETURNING id`, x.e).Scan(x.v); err != nil {
			t.Fatal(err)
		}
	}
	var msg int64
	if err := p.QueryRow(ctx, `INSERT INTO room_messages (showtime_id, account_id, name, body, country) VALUES ('fx-show', $1, 'Fx', 'you are rubbish', 'NG') RETURNING id`, a).Scan(&msg); err != nil {
		t.Fatal(err)
	}
	p.Exec(ctx, `INSERT INTO room_reports (reporter_id, reported_id, message_id, showtime_id, reason) VALUES ($1, $3, $4, 'fx-show', 'harassment'), ($2, $3, $4, 'fx-show', 'hate')`, b, c, a, msg)
	for i := 0; i < 10; i++ {
		p.Exec(ctx, `INSERT INTO sign_in_failures (email) VALUES ('fx-locked@example.com')`)
	}
	st := exec.Store{DB: p, CEOs: []string{"fx-ceo@example.com"}}
	if _, err := st.Safety(ctx, "fx-cfo@example.com", time.Now()); !errors.Is(err, exec.ErrForbidden) {
		t.Fatalf("cfo: %v", err)
	}
	s, err := st.Safety(ctx, "fx-coo@example.com", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, q := range s.Queue {
		if q.MessageID == msg {
			found = q.Reporters == 2 && q.Film == "Fx Film" && q.Country == "NG" && q.Body == "you are rubbish"
		}
	}
	if !found || s.ReportsToday < 2 || s.Lockouts < 1 {
		t.Fatalf("safety = %+v", s)
	}
}

func TestHiring(t *testing.T) {
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
	clean := func() {
		p.Exec(ctx, `DELETE FROM executives WHERE email LIKE 'hx-%@example.com'`)
		p.Exec(ctx, `DELETE FROM jobs WHERE slug LIKE 'hx-%'`)
		p.Exec(ctx, `DELETE FROM accounts WHERE email LIKE 'hx-%@example.com'`)
	}
	clean()
	t.Cleanup(clean)
	p.Exec(ctx, `INSERT INTO executives (email, role) VALUES ('hx-coo@example.com', 'coo'), ('hx-cmo@example.com', 'cmo')`)
	p.Exec(ctx, `INSERT INTO jobs (slug, title, team, city, country, kind, quota, about, bring) VALUES
	  ('hx-a', 'A', 'Hxteam', 'Lagos', 'NG', 'full', 'ng', 'x', 'y'), ('hx-b', 'B', 'Hxteam', 'Nairobi', 'KE', 'full', 'world', 'x', 'y')`)
	var a1, a2 string
	p.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash) VALUES ('hx-1@example.com', 'H', '!') RETURNING id`).Scan(&a1)
	p.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash) VALUES ('hx-2@example.com', 'H', '!') RETURNING id`).Scan(&a2)
	var app string
	p.QueryRow(ctx, `INSERT INTO job_applications (job_slug, account_id, name, email, country, cv_key, stage) VALUES ('hx-a', $1, 'H', 'hx-1@example.com', 'NG', 'cv', 'hired') RETURNING id`, a1).Scan(&app)
	p.Exec(ctx, `INSERT INTO job_application_events (application_id, stage, at) VALUES ($1, 'task', now() - interval '3 days'), ($1, 'hired', now())`, app)
	p.Exec(ctx, `INSERT INTO job_applications (job_slug, account_id, name, email, country, cv_key, stage) VALUES ('hx-b', $1, 'H', 'hx-2@example.com', 'IN', 'cv', 'closed')`, a2)
	st := exec.Store{DB: p, CEOs: []string{"hx-ceo@example.com"}}
	if _, err := st.Hiring(ctx, "hx-cmo@example.com", time.Now()); !errors.Is(err, exec.ErrForbidden) {
		t.Fatalf("cmo: %v", err)
	}
	h, err := st.Hiring(ctx, "hx-coo@example.com", time.Now())
	if err != nil || !h.CanPost || h.CanQuota || h.HiredYear < 1 || h.HiredNG < 1 || h.ByCountry["IN"] < 1 {
		t.Fatalf("coo hiring = %+v %v", h, err)
	}
	var team bool
	for _, tm := range h.Teams {
		if tm.Team == "Hxteam" {
			team = tm.NG == 1 && tm.Total == 2
		}
	}
	if !team || len(h.Pipeline) != 6 || h.Pipeline[0].NG < 1 || h.Pipeline[5].NG < 1 || h.Pipeline[0].World < 1 {
		t.Fatalf("teams/pipeline = %+v %+v", h.Teams, h.Pipeline)
	}
	if st.CanSetQuota("hx-coo@example.com") == nil || st.CanSetQuota("hx-ceo@example.com") != nil {
		t.Fatal("only the CEO sets the quota")
	}
}

func TestBrand(t *testing.T) {
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
	clean := func() {
		p.Exec(ctx, `DELETE FROM executives WHERE email LIKE 'bx-%@example.com'`)
		p.Exec(ctx, `DELETE FROM accounts WHERE email LIKE 'bx-%@example.com'`)
	}
	clean()
	t.Cleanup(clean)
	p.Exec(ctx, `INSERT INTO executives (email, role) VALUES ('bx-cmo@example.com', 'cmo'), ('bx-cfo@example.com', 'cfo')`)
	var a string
	p.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash) VALUES ('bx-r@example.com', 'Bxada Okafor', '!') RETURNING id`).Scan(&a)
	if _, err := p.Exec(ctx, `INSERT INTO brand_reports (account_id, country, place, link, selling, status, outcome, reward_ngn, decided_at) VALUES
	  ($1, 'GH', 'market', 'Makola', 'Bx fake tees', 'confirmed', 'taken down', 10000, now()),
	  ($1, 'GH', 'online', 'https://x.example', 'Bx fake caps', 'sent', '', 0, NULL)`, a); err != nil {
		t.Fatal(err)
	}
	st := exec.Store{DB: p}
	if _, err := st.Brand(ctx, "bx-cfo@example.com", time.Now()); !errors.Is(err, exec.ErrForbidden) {
		t.Fatalf("cfo: %v", err)
	}
	b, err := st.Brand(ctx, "bx-cmo@example.com", time.Now())
	if err != nil || b.Month < 2 || b.Confirmed < 1 || b.RewardsNGN < 10000 || b.Countries["GH"] < 2 || len(b.Weeks) != 12 || b.Weeks[11].Reports < 2 {
		t.Fatalf("brand = %+v %v", b, err)
	}
	var queued, top bool
	for _, q := range b.Queue {
		queued = queued || q.Selling == "Bx fake caps"
	}
	for _, r := range b.TopReporter {
		top = top || r.Name == "Bxada O."
	}
	if !queued || !top {
		t.Fatalf("queue %+v top %+v", b.Queue, b.TopReporter)
	}
}

func TestSecurity(t *testing.T) {
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
	clean := func() {
		p.Exec(ctx, `DELETE FROM executives WHERE email LIKE 'sx-%@example.com'`)
		p.Exec(ctx, `DELETE FROM sign_in_failures WHERE email LIKE 'sx-%@example.com'`)
		p.Exec(ctx, `DELETE FROM security_incidents WHERE created_by LIKE 'sx-%@example.com'`)
		p.Exec(ctx, `UPDATE security_settings SET lockdown = false, lockdown_by = '', lockdown_at = NULL`)
	}
	clean()
	t.Cleanup(clean)
	st := exec.Store{DB: p, CEOs: []string{"sx-ceo@example.com"}}
	p.Exec(ctx, `INSERT INTO executives (email, role) VALUES ('sx-cto@example.com', 'cto'), ('sx-cfo@example.com', 'cfo')`)
	for i := 0; i < 11; i++ {
		p.Exec(ctx, `INSERT INTO sign_in_failures (email, at) VALUES ('sx-victim@example.com', now() - interval '1 minute')`)
	}
	if _, err := st.Security(ctx, "sx-cfo@example.com", time.Now()); !errors.Is(err, exec.ErrForbidden) {
		t.Fatalf("cfo: %v", err)
	}
	if err := st.SetLockdown(ctx, "sx-cfo@example.com", true); !errors.Is(err, exec.ErrForbidden) {
		t.Fatalf("cfo lockdown: %v", err)
	}
	s, err := st.Security(ctx, "sx-cto@example.com", time.Now())
	if err != nil || s.WrongPw24h < 11 || s.Locked24h < 1 || s.Takeovers < 1 || s.Lockdown {
		t.Fatalf("security = %+v, %v", s, err)
	}
	found := false
	for _, e := range s.Events {
		found = found || (e.Title == "11 wrong passwords on s***@example.com" && e.Result == "blocked")
	}
	if !found {
		t.Fatalf("events = %+v", s.Events)
	}
	if err := st.SetLockdown(ctx, "sx-ceo@example.com", true); err != nil {
		t.Fatal(err)
	}
	if _, err := st.LogIncident(ctx, "sx-cto@example.com", exec.Incident{Title: "x", Kind: "breach", Severity: "low"}); !errors.Is(err, exec.ErrBadInput) {
		t.Fatalf("short title: %v", err)
	}
	in, err := st.LogIncident(ctx, "sx-cto@example.com", exec.Incident{Title: "Sx credential stuffing wave", Kind: "attack", Severity: "critical"})
	if err != nil || in.Status != "open" {
		t.Fatalf("incident = %+v, %v", in, err)
	}
	pt, _ := st.LogIncident(ctx, "sx-cto@example.com", exec.Incident{Title: "Sx yearly pen test", Kind: "pentest", Severity: "low", Note: "3 low findings fixed"})
	if pt.Status != "closed" {
		t.Fatalf("pen test = %+v", pt)
	}
	s, _ = st.Security(ctx, "sx-cto@example.com", time.Now())
	if !s.Lockdown || s.LockdownBy != "sx-ceo@example.com" || s.OpenCritical < 1 || s.LastPenTest == nil || len(s.Incidents) < 2 {
		t.Fatalf("after = %+v", s)
	}
	if err := st.CloseIncident(ctx, "sx-cto@example.com", in.ID, true); err != nil {
		t.Fatal(err)
	}
	if err := st.CloseIncident(ctx, "sx-cto@example.com", 0, true); !errors.Is(err, exec.ErrBadInput) {
		t.Fatalf("missing incident: %v", err)
	}
}

func TestInfra(t *testing.T) {
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
	clean := func() {
		p.Exec(ctx, `DELETE FROM executives WHERE email LIKE 'ix-%@example.com'`)
		p.Exec(ctx, `DELETE FROM infra_backups WHERE object_key LIKE 'db/ix-%'`)
	}
	clean()
	t.Cleanup(clean)
	st := exec.Store{DB: p}
	p.Exec(ctx, `INSERT INTO executives (email, role) VALUES ('ix-cto@example.com', 'cto'), ('ix-cmo@example.com', 'cmo')`)
	p.Exec(ctx, `INSERT INTO infra_backups (target, object_key, bytes, tables, restored, started_at) VALUES ('r2', 'db/ix-1.dump', 1234, 90, true, now() - interval '2 minutes')`)
	if _, err := st.Infra(ctx, "ix-cmo@example.com", time.Now()); !errors.Is(err, exec.ErrForbidden) {
		t.Fatalf("cmo: %v", err)
	}
	in, err := st.Infra(ctx, "ix-cto@example.com", time.Now())
	if err != nil || in.DBMaxConns == 0 || in.DBBytes == 0 || in.DBVersion == "" || len(in.Backups) == 0 || in.Backups[0].Key != "db/ix-1.dump" || !in.Backups[0].Restored {
		t.Fatalf("infra = %+v, %v", in, err)
	}
}

func TestInvestor(t *testing.T) {
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
	clean := func() {
		p.Exec(ctx, `DELETE FROM executives WHERE email LIKE 'vx-%@example.com'`)
		p.Exec(ctx, `DELETE FROM investor_milestones WHERE title LIKE 'Vx %'`)
	}
	clean()
	t.Cleanup(clean)
	st := exec.Store{DB: p, CEOs: []string{"vx-ceo@example.com"}}
	p.Exec(ctx, `INSERT INTO executives (email, role) VALUES ('vx-inv@example.com', 'investor'), ('vx-cmo@example.com', 'cmo')`)
	if _, err := st.Investor(ctx, "vx-cmo@example.com", time.Now()); !errors.Is(err, exec.ErrForbidden) {
		t.Fatalf("cmo: %v", err)
	}
	in, err := st.Investor(ctx, "vx-inv@example.com", time.Now())
	if err != nil || in.CanEdit || in.Members == 0 || in.Paying == nil {
		t.Fatalf("investor = %+v, %v", in, err)
	}
	if _, err := st.SaveMilestone(ctx, "vx-inv@example.com", exec.Milestone{Quarter: "Q1 2027", Title: "Vx launch"}); !errors.Is(err, exec.ErrForbidden) {
		t.Fatalf("investor editing: %v", err)
	}
	if _, err := st.SaveMilestone(ctx, "vx-ceo@example.com", exec.Milestone{Quarter: "2027", Title: "Vx launch"}); !errors.Is(err, exec.ErrBadInput) {
		t.Fatalf("bad quarter: %v", err)
	}
	m, err := st.SaveMilestone(ctx, "vx-ceo@example.com", exec.Milestone{Quarter: "q1 2027", Title: "Vx launch in Ghana"})
	if err != nil || m.ID == 0 || m.Quarter != "Q1 2027" {
		t.Fatalf("milestone = %+v, %v", m, err)
	}
	m.Done = true
	if _, err := st.SaveMilestone(ctx, "vx-ceo@example.com", m); err != nil {
		t.Fatal(err)
	}
	in, _ = st.Investor(ctx, "vx-ceo@example.com", time.Now())
	found := false
	for _, x := range in.Milestones {
		found = found || (x.ID == m.ID && x.Done)
	}
	if !found || !in.CanEdit {
		t.Fatalf("milestones = %+v", in.Milestones)
	}
	if err := st.DeleteMilestone(ctx, "vx-ceo@example.com", m.ID); err != nil {
		t.Fatal(err)
	}
}

func TestStakeholder(t *testing.T) {
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
	clean := func() {
		p.Exec(ctx, `DELETE FROM executives WHERE email LIKE 'kx-%@example.com'`)
		p.Exec(ctx, `DELETE FROM stakeholder_docs WHERE shared_by LIKE 'kx-%@example.com'`)
		p.Exec(ctx, `UPDATE stakeholder_note SET body = '', updated_by = '', updated_at = NULL`)
	}
	clean()
	t.Cleanup(clean)
	st := exec.Store{DB: p, CEOs: []string{"kx-ceo@example.com"}}
	p.Exec(ctx, `INSERT INTO executives (email, role) VALUES ('kx-sh@example.com', 'stakeholder'), ('kx-inv@example.com', 'investor')`)
	if _, err := st.Stakeholder(ctx, "kx-inv@example.com", time.Now()); !errors.Is(err, exec.ErrForbidden) {
		t.Fatalf("investor: %v", err)
	}
	if err := st.SetNote(ctx, "kx-sh@example.com", "hi"); !errors.Is(err, exec.ErrForbidden) {
		t.Fatalf("stakeholder writing: %v", err)
	}
	if err := st.SetNote(ctx, "kx-ceo@example.com", "  A calm first month.  "); err != nil {
		t.Fatal(err)
	}
	if _, err := st.AddDoc(ctx, "kx-ceo@example.com", "Bad", "../x.pdf", 10); !errors.Is(err, exec.ErrBadInput) {
		t.Fatalf("bad key: %v", err)
	}
	d, err := st.AddDoc(ctx, "kx-ceo@example.com", "November update.pdf", "board/11111111-2222-4333-8444-555555555555.pdf", 2048)
	if err != nil {
		t.Fatal(err)
	}
	s, err := st.Stakeholder(ctx, "kx-sh@example.com", time.Now())
	if err != nil || s.Note != "A calm first month." || s.CanEdit || len(s.Docs) == 0 || s.Members == 0 {
		t.Fatalf("stakeholder = %+v, %v", s, err)
	}
	if key, _, err := st.DocKey(ctx, "kx-sh@example.com", d.ID); err != nil || key != "board/11111111-2222-4333-8444-555555555555.pdf" {
		t.Fatalf("doc key = %q, %v", key, err)
	}
	if _, _, err := st.DocKey(ctx, "kx-inv@example.com", d.ID); !errors.Is(err, exec.ErrForbidden) {
		t.Fatalf("investor doc: %v", err)
	}
	if err := st.DeleteDoc(ctx, "kx-ceo@example.com", d.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := st.DocKey(ctx, "kx-sh@example.com", d.ID); !errors.Is(err, exec.ErrNotFound) {
		t.Fatalf("deleted doc: %v", err)
	}
}

func TestPartner(t *testing.T) {
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
	clean := func() { p.Exec(ctx, `DELETE FROM executives WHERE email LIKE 'px-%@example.com'`) }
	clean()
	t.Cleanup(clean)
	st := exec.Store{DB: p, CEOs: []string{"px-ceo@example.com"}}
	p.Exec(ctx, `INSERT INTO executives (email, role, name, org) VALUES ('px-pay@example.com', 'partner', 'Ife Obi', 'Kola Pay'), ('px-tel@example.com', 'partner', 'Musa Bello', 'Harmattan Mobile'), ('px-cmo@example.com', 'cmo', '', '')`)
	if _, err := st.Partner(ctx, "px-cmo@example.com", "", time.Now()); !errors.Is(err, exec.ErrForbidden) {
		t.Fatalf("cmo: %v", err)
	}
	pv, err := st.Partner(ctx, "px-pay@example.com", "", time.Now())
	if err != nil || pv.Deal != nil || pv.CanEdit {
		t.Fatalf("no deal yet = %+v, %v", pv, err)
	}
	if err := st.SaveDeal(ctx, "px-pay@example.com", exec.Deal{Email: "px-pay@example.com", Kind: "other"}); !errors.Is(err, exec.ErrForbidden) {
		t.Fatalf("partner editing: %v", err)
	}
	if err := st.SaveDeal(ctx, "px-ceo@example.com", exec.Deal{Email: "px-pay@example.com", Kind: "payments", Provider: "venmo"}); !errors.Is(err, exec.ErrBadInput) {
		t.Fatalf("bad provider: %v", err)
	}
	if err := st.SaveDeal(ctx, "px-ceo@example.com", exec.Deal{Email: "px-cmo@example.com", Kind: "other"}); !errors.Is(err, exec.ErrNotFound) {
		t.Fatalf("not a partner: %v", err)
	}
	if err := st.SaveDeal(ctx, "px-ceo@example.com", exec.Deal{Email: "PX-pay@example.com", Kind: "payments", Provider: "paystack", Summary: "Card and bank payments in Nigeria", Plan: []string{"Joint fraud desk", " "}}); err != nil {
		t.Fatal(err)
	}
	st.SaveDeal(ctx, "px-ceo@example.com", exec.Deal{Email: "px-tel@example.com", Kind: "carrier"})
	pv, err = st.Partner(ctx, "px-pay@example.com", "px-tel@example.com", time.Now())
	if err != nil || pv.Deal == nil || pv.Deal.Org != "Kola Pay" || pv.Stats == nil || len(pv.Deal.Plan) != 1 {
		t.Fatalf("payments partner = %+v, %v", pv, err)
	}
	ceo, err := st.Partner(ctx, "px-ceo@example.com", "px-tel@example.com", time.Now())
	if err != nil || !ceo.CanEdit || ceo.Deal == nil || ceo.Deal.Kind != "carrier" || ceo.Stats != nil || len(ceo.Deals) < 2 {
		t.Fatalf("ceo preview = %+v, %v", ceo, err)
	}
}

func TestRecipients(t *testing.T) {
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
	clean := func() { p.Exec(ctx, `DELETE FROM adult_recipients WHERE name LIKE 'rx-%'`) }
	clean()
	t.Cleanup(clean)
	st := exec.Store{DB: p, CEOs: []string{"rx-ceo@example.com"}}
	if _, err := st.Recipients(ctx, "rx-cfo@example.com", time.Now()); !errors.Is(err, exec.ErrForbidden) {
		t.Fatalf("not ceo: %v", err)
	}
	if _, err := st.SaveRecipient(ctx, "rx-ceo@example.com", exec.AdultRecipient{Kind: "imam", Name: "rx-a", Country: "NG"}); !errors.Is(err, exec.ErrBadInput) {
		t.Fatalf("bad kind: %v", err)
	}
	if _, err := st.SaveRecipient(ctx, "rx-ceo@example.com", exec.AdultRecipient{Kind: "charity", Name: "rx-a", Country: "NG", AccountNo: "12ab"}); !errors.Is(err, exec.ErrBadInput) {
		t.Fatalf("bad account: %v", err)
	}
	if _, err := st.SaveRecipient(ctx, "rx-ceo@example.com", exec.AdultRecipient{Kind: "charity", Name: "rx-a", Country: "NG", Status: "active"}); !errors.Is(err, exec.ErrBadInput) {
		t.Fatalf("active with no bank: %v", err)
	}
	r, err := st.SaveRecipient(ctx, "rx-ceo@example.com", exec.AdultRecipient{Kind: "charity", Name: " rx-Hope Wells ", Country: "ng", Bank: "Kola Bank", AccountNo: "0123456789", AccountName: "HOPE WELLS"})
	if err != nil || r.ID == "" || r.Status != "pending" || r.AccountLast != "6789" || r.AccountNo != "" || r.Country != "NG" {
		t.Fatalf("add = %+v, %v", r, err)
	}
	if err := st.SetRecipientStatus(ctx, "rx-ceo@example.com", r.ID, "active"); err != nil {
		t.Fatal(err)
	}
	r.Name, r.Note, r.Status = "rx-Hope Wells Trust", "Boreholes", "active"
	if _, err := st.SaveRecipient(ctx, "rx-ceo@example.com", r); err != nil {
		t.Fatal(err)
	}
	pg, err := st.Recipients(ctx, "rx-ceo@example.com", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	var got *exec.AdultRecipient
	for i := range pg.Recipients {
		if pg.Recipients[i].ID == r.ID {
			got = &pg.Recipients[i]
		}
	}
	if got == nil || got.Name != "rx-Hope Wells Trust" || got.AccountLast != "6789" || got.Status != "active" || got.AccountNo != "" {
		t.Fatalf("list = %+v", got)
	}
	if err := st.SetRecipientStatus(ctx, "rx-ceo@example.com", "00000000-0000-0000-0000-000000000000", "paused"); !errors.Is(err, exec.ErrNotFound) {
		t.Fatalf("missing: %v", err)
	}
}

func TestCampaigns(t *testing.T) {
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
	clean := func() {
		p.Exec(ctx, `DELETE FROM exec_campaigns WHERE created_by LIKE 'cx-%'`)
		p.Exec(ctx, `DELETE FROM executives WHERE email LIKE 'cx-%@example.com'`)
		p.Exec(ctx, `DELETE FROM accounts WHERE email LIKE 'cx-%@example.com'`)
	}
	clean()
	t.Cleanup(clean)
	st := exec.Store{DB: p, CEOs: []string{"cx-ceo@example.com"}}
	p.Exec(ctx, `INSERT INTO executives (email, role) VALUES ('cx-cmo@example.com', 'cmo'), ('cx-cfo@example.com', 'cfo')`)
	p.Exec(ctx, `INSERT INTO accounts (email, name, password_hash, country, app_language, prefs) VALUES
	  ('cx-a@example.com', 'Ada', 'x', 'ZW', 'yo', '{}'), ('cx-b@example.com', 'Bayo', 'x', 'ZW', 'en', '{"n.features.email": false}'), ('cx-c@example.com', 'Chi', 'x', 'GH', 'en', '{}')`)
	now := time.Now()
	if _, err := st.Campaigns(ctx, "cx-cfo@example.com", now); !errors.Is(err, exec.ErrForbidden) {
		t.Fatalf("cfo: %v", err)
	}
	if _, err := st.SaveCampaign(ctx, "cx-cmo@example.com", exec.Campaign{Title: "VR is here", Audience: "country", Channels: []string{"inapp"}}, nil, now); !errors.Is(err, exec.ErrBadInput) {
		t.Fatalf("no country: %v", err)
	}
	if _, err := st.SaveCampaign(ctx, "cx-cmo@example.com", exec.Campaign{Title: "VR is here", Audience: "everyone", Channels: []string{"push"}}, nil, now); !errors.Is(err, exec.ErrBadInput) {
		t.Fatalf("no channel: %v", err)
	}
	c, err := st.SaveCampaign(ctx, "cx-cmo@example.com", exec.Campaign{Title: "VR premieres are here", Body: "Put on your headset", Link: "/browse", Audience: "country", Country: "zw", Channels: []string{"inapp", "email"}, SendAt: now.Add(time.Hour)},
		[]exec.Text{{Lang: "yo", Title: "Àwọn àfihàn VR ti dé", Body: "Wọ agbekọri rẹ"}, {Lang: "en", Title: "skip"}}, now)
	if err != nil || c.Status != "scheduled" || c.Langs != 1 || c.Country != "ZW" {
		t.Fatalf("save = %+v, %v", c, err)
	}
	if due, err := st.DueCampaigns(ctx, now); err != nil || len(due) != 0 {
		t.Fatalf("not due yet = %v, %v", due, err)
	}
	test, err := st.TestCampaign(ctx, "cx-cmo@example.com", c.ID, now)
	if err != nil || len(test.Recipients) > 1 {
		t.Fatalf("test = %+v, %v", test, err)
	}
	due, err := st.DueCampaigns(ctx, now.Add(2*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	var mine *exec.Batch
	for i := range due {
		if due[i].Campaign.ID == c.ID {
			mine = &due[i]
		}
	}
	emailed := len(test.Recipients)
	if mine != nil {
		emailed += len(mine.Recipients)
		for _, r := range mine.Recipients {
			if r.Email == "cx-b@example.com" || r.Email == "cx-c@example.com" {
				t.Fatalf("emailed %s", r.Email)
			}
		}
	}
	if emailed != 1 {
		t.Fatalf("emails = %d (only Ada keeps news email on in ZW)", emailed)
	}
	var title string
	p.QueryRow(ctx, `SELECT n.title FROM notifications n JOIN accounts a ON a.id = n.account_id WHERE a.email = 'cx-a@example.com' AND n.campaign_id = $1`, c.ID).Scan(&title)
	var n int
	p.QueryRow(ctx, `SELECT count(*) FROM notifications WHERE campaign_id = $1`, c.ID).Scan(&n)
	if title != "Àwọn àfihàn VR ti dé" || n != 2 {
		t.Fatalf("in-app: %q, %d rows", title, n)
	}
	st.CampaignEmailed(ctx, c.ID, 1)
	pg, err := st.Campaigns(ctx, "cx-ceo@example.com", now.Add(2*time.Hour))
	if err != nil || len(pg.Campaigns) == 0 || pg.Campaigns[0].ID != c.ID || pg.Campaigns[0].Status != "sent" || pg.Campaigns[0].Emailed != 1 || pg.Campaigns[0].Sent+pg.Campaigns[0].TestSent != 2 {
		t.Fatalf("page = %+v, %v", pg.Campaigns, err)
	}
	if err := st.CancelCampaign(ctx, "cx-cmo@example.com", c.ID); !errors.Is(err, exec.ErrNotFound) {
		t.Fatalf("cancel sent: %v", err)
	}
}

func TestSettings(t *testing.T) {
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
	clean := func() {
		p.Exec(ctx, `DELETE FROM platform_settings`)
		p.Exec(ctx, `DELETE FROM settings_audit WHERE actor LIKE 'sx-%'`)
		p.Exec(ctx, `DELETE FROM accounts WHERE email LIKE 'sx-%@example.com'`)
	}
	clean()
	t.Cleanup(clean)
	st := exec.Store{DB: p, CEOs: []string{"sx-ceo@example.com"}}
	var ceoID, cfoID string
	p.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash) VALUES ('sx-ceo@example.com', 'Bo', 'x') RETURNING id`).Scan(&ceoID)
	p.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash) VALUES ('sx-cfo@example.com', 'Tolu', 'x') RETURNING id`).Scan(&cfoID)
	v, err := st.Platform(ctx)
	if err != nil || v["pay.paystack"] != true || v["sec.strong"] != false {
		t.Fatalf("defaults = %v, %v", v, err)
	}
	if err := st.SetSetting(ctx, "sx-cfo@example.com", cfoID, "pay.paystack", false); !errors.Is(err, exec.ErrForbidden) {
		t.Fatalf("cfo: %v", err)
	}
	if err := st.SetSetting(ctx, "sx-ceo@example.com", ceoID, "pay.stripe", true); !errors.Is(err, exec.ErrBadInput) {
		t.Fatalf("unknown: %v", err)
	}
	if err := st.SetSetting(ctx, "sx-ceo@example.com", ceoID, "pay.paystack", "no"); !errors.Is(err, exec.ErrBadInput) {
		t.Fatalf("type: %v", err)
	}
	if err := st.SetSetting(ctx, "sx-ceo@example.com", ceoID, "company.support", "not an email"); !errors.Is(err, exec.ErrBadInput) {
		t.Fatalf("email: %v", err)
	}
	if err := st.SetSetting(ctx, "sx-ceo@example.com", ceoID, "pay.paystack", false); err != nil {
		t.Fatal(err)
	}
	st.SetSetting(ctx, "sx-ceo@example.com", ceoID, "pay.paystack", false) // no change, no log
	if err := st.SetSetting(ctx, "sx-ceo@example.com", ceoID, "sec.strong", true); !errors.Is(err, exec.ErrBadInput) {
		t.Fatalf("strong without passkey: %v", err)
	}
	p.Exec(ctx, `UPDATE accounts SET face_verified_at = now() WHERE id = $1`, ceoID)
	p.Exec(ctx, `INSERT INTO passkeys (id, account_id, credential, name) VALUES ('\x0102', $1, '{}', 'Laptop')`, ceoID)
	if err := st.SetSetting(ctx, "sx-ceo@example.com", ceoID, "sec.strong", true); err != nil {
		t.Fatal(err)
	}
	if ok, _ := st.StrongOK(ctx, cfoID); ok {
		t.Fatal("cfo without passkey passes strong")
	}
	if ok, _ := st.StrongOK(ctx, ceoID); !ok {
		t.Fatal("ceo with passkey fails strong")
	}
	pg, err := st.Settings(ctx, "sx-ceo@example.com", ceoID)
	if err != nil || pg.Values["pay.paystack"] != false || len(pg.Audit) != 2 || pg.Audit[0].Key != "sec.strong" || !pg.Strong {
		t.Fatalf("settings = %+v, %v", pg, err)
	}
}

func TestInvites(t *testing.T) {
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
	clean := func() {
		p.Exec(ctx, `DELETE FROM executives WHERE email LIKE 'ix-%@example.com'`)
		p.Exec(ctx, `DELETE FROM accounts WHERE email LIKE 'ix-%@example.com'`)
	}
	clean()
	t.Cleanup(clean)
	st := exec.Store{DB: p, CEOs: []string{"ix-ceo@example.com"}}
	now := time.Now()
	added, err := st.Grant(ctx, "ix-ceo@example.com", "", exec.Grant{Email: "ix-coo@example.com", Role: "coo", Name: "Amaka"}, now)
	if err != nil || !added {
		t.Fatalf("grant: %v %v", added, err)
	}
	if r, _ := st.Role(ctx, "ix-coo@example.com"); r != "" {
		t.Fatalf("pending person has role %q", r)
	}
	if _, err := st.NewInvite(ctx, "ix-coo@example.com", "ix-coo@example.com", "x", now); !errors.Is(err, exec.ErrForbidden) {
		t.Fatalf("non-ceo invite: %v", err)
	}
	old, _ := st.NewInvite(ctx, "ix-ceo@example.com", "ix-coo@example.com", "Bolaji", now)
	tok, err := st.NewInvite(ctx, "ix-ceo@example.com", "ix-coo@example.com", "Bolaji", now)
	if err != nil || tok == "" {
		t.Fatalf("invite: %q %v", tok, err)
	}
	if _, err := st.LookInvite(ctx, old, now); !errors.Is(err, exec.ErrNotFound) {
		t.Fatalf("old link should be replaced: %v", err)
	}
	in, err := st.LookInvite(ctx, tok, now)
	if err != nil || in.Gone || in.Role != "coo" || in.By != "Bolaji" || in.Name != "Amaka" {
		t.Fatalf("look: %+v %v", in, err)
	}
	var id, otherID string
	p.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash) VALUES ('ix-coo@example.com', 'Amaka', 'x') RETURNING id`).Scan(&id)
	p.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash) VALUES ('ix-other@example.com', 'Eve', 'x') RETURNING id`).Scan(&otherID)
	if _, err := st.InviteCode(ctx, tok, "ix-other@example.com", now); !errors.Is(err, exec.ErrWrongPerson) {
		t.Fatalf("wrong person code: %v", err)
	}
	code, err := st.InviteCode(ctx, tok, "ix-coo@example.com", now)
	if err != nil || len(code) != 6 {
		t.Fatalf("code: %q %v", code, err)
	}
	if _, err := st.InviteCode(ctx, tok, "ix-coo@example.com", now.Add(10*time.Second)); !errors.Is(err, exec.ErrBadInput) {
		t.Fatalf("resend gap: %v", err)
	}
	wrong := "000000"
	if code == wrong {
		wrong = "111111"
	}
	if err := st.ConfirmInviteCode(ctx, tok, "ix-coo@example.com", wrong, now); !errors.Is(err, exec.ErrBadInput) {
		t.Fatalf("wrong code: %v", err)
	}
	if err := st.AcceptInvite(ctx, tok, "ix-coo@example.com", id, now); !errors.Is(err, exec.ErrBadInput) {
		t.Fatalf("accept before email: %v", err)
	}
	if err := st.ConfirmInviteCode(ctx, tok, "ix-coo@example.com", code, now); err != nil {
		t.Fatalf("confirm: %v", err)
	}
	if err := st.AcceptInvite(ctx, tok, "ix-coo@example.com", id, now); err == nil {
		t.Fatal("accept without face")
	}
	p.Exec(ctx, `UPDATE accounts SET face_verified_at = now() WHERE id = $1`, id)
	if err := st.AcceptInvite(ctx, tok, "ix-coo@example.com", id, now); err == nil {
		t.Fatal("accept without passkey")
	}
	p.Exec(ctx, `INSERT INTO passkeys (id, account_id, credential, name) VALUES ('\x0102', $1, '{}', 'Phone')`, id)
	if err := st.AcceptInvite(ctx, tok, "ix-coo@example.com", id, now.Add(InviteHours(49))); !errors.Is(err, exec.ErrInviteGone) {
		t.Fatalf("expired: %v", err)
	}
	if err := st.AcceptInvite(ctx, tok, "ix-coo@example.com", id, now); err != nil {
		t.Fatalf("accept: %v", err)
	}
	if r, _ := st.Role(ctx, "ix-coo@example.com"); r != "coo" {
		t.Fatalf("role after accept = %q", r)
	}
	if err := st.AcceptInvite(ctx, tok, "ix-coo@example.com", id, now); !errors.Is(err, exec.ErrInviteGone) {
		t.Fatalf("second use: %v", err)
	}
	if tok2, err := st.NewInvite(ctx, "ix-ceo@example.com", "ix-coo@example.com", "Bolaji", now); err != nil || tok2 != "" {
		t.Fatalf("joined person needs no link: %q %v", tok2, err)
	}
}

func InviteHours(h int) time.Duration { return time.Duration(h) * time.Hour }
