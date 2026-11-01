package brand_test

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/Bolajiomo99/E-Cinema/api/internal/brand"
	"github.com/Bolajiomo99/E-Cinema/api/internal/db"
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

func account(t *testing.T, p *pgxpool.Pool, email, name string) string {
	t.Helper()
	var id string
	if err := p.QueryRow(context.Background(), `INSERT INTO accounts (email, name, password_hash) VALUES ($1, $2, '!')
	  ON CONFLICT (email) DO UPDATE SET name = $2 RETURNING id`, email, name).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestNormCode(t *testing.T) {
	for in, want := range map[string]string{
		" ec-qr-7f3k-29xa ": "EC-QR-7F3K-29XA",
		"ECQR7F3K29XA":      "EC-QR-7F3K-29XA",
		"https://e-cinema.net/verify?code=EC-QR-7F3K-29XA": "EC-QR-7F3K-29XA",
		"7F3K 29XA": "EC-QR-7F3K-29XA",
	} {
		if got := brand.NormCode(in); got != want {
			t.Errorf("NormCode(%q) = %q", in, got)
		}
	}
	if brand.ShortName("Adaeze Okafor") != "Adaeze O." || brand.ShortName("") != "Member" {
		t.Error("ShortName")
	}
	list := []brand.Licensee{{Licence: "NG-0042", Website: "lagosthreads.ng"}}
	if brand.PartnerAt(list, "https://shop.lagosthreads.ng/tees") == nil || brand.PartnerAt(list, "ecinema-store-ng.shop") != nil || brand.PartnerAt(list, "Balogun market") != nil {
		t.Error("PartnerAt")
	}
}

func TestBrand(t *testing.T) {
	p := pool(t)
	ctx := context.Background()
	st := brand.Store{DB: p}
	ada := account(t, p, "brand-ada@example.com", "Adaeze Okafor")
	kim := account(t, p, "brand-kim@example.com", "Kim Lee")
	clean := func() {
		p.Exec(ctx, `DELETE FROM brand_scans WHERE code LIKE 'EC-QR-T%' OR code = 'EC-QR-7F3K-29XB'`)
		p.Exec(ctx, `DELETE FROM brand_codes WHERE code LIKE 'EC-QR-T%'`)
		p.Exec(ctx, `UPDATE brand_codes SET scans = 0, first_scan_at = NULL WHERE code = 'EC-QR-7F3K-29XB'`)
		p.Exec(ctx, `DELETE FROM credits WHERE ref LIKE 'brand:%' AND account_id IN ($1, $2)`, ada, kim)
		p.Exec(ctx, `DELETE FROM brand_reports WHERE account_id IN ($1, $2)`, ada, kim)
	}
	clean()
	t.Cleanup(clean)

	// A real label: genuine on its first scan, still genuine for a second person in the same city.
	c, err := st.Verify(ctx, "ec-qr-7f3k-29xb", brand.Place{City: "Lagos", Country: "ng"}, ada)
	if err != nil || !c.Genuine || !c.First || c.Licensee == nil || c.Licensee.Licence != "NG-0042" || c.Product == "" {
		t.Fatalf("first scan = %+v, %v", c, err)
	}
	c, _ = st.Verify(ctx, "EC-QR-7F3K-29XB", brand.Place{City: "Lagos", Country: "NG"}, "")
	if !c.Genuine || c.First || c.Scans != 2 {
		t.Fatalf("second scan = %+v", c)
	}
	// The same label turning up in two more cities has been copied.
	st.Verify(ctx, "EC-QR-7F3K-29XB", brand.Place{City: "Abuja", Country: "NG"}, "")
	c, _ = st.Verify(ctx, "EC-QR-7F3K-29XB", brand.Place{City: "Kano", Country: "NG"}, "")
	if c.Genuine || c.Reason != "copied" || c.Places != 3 || c.Product != "" {
		t.Fatalf("copied = %+v", c)
	}
	// Never issued, and garbage.
	c, _ = st.Verify(ctx, "EC-QR-TTTT-0000", brand.Place{Country: "GH"}, "")
	if c.Genuine || c.Reason != "never" || c.Licensee != nil {
		t.Fatalf("never = %+v", c)
	}
	if c, _ := st.Verify(ctx, "hello", brand.Place{}, ""); c.Reason != "bad" {
		t.Fatalf("bad = %+v", c)
	}
	// A suspended partner's labels no longer count.
	p.Exec(ctx, `INSERT INTO brand_codes (code, licence, product) VALUES ('EC-QR-TEND-0001', 'NG-0051', 'Cap')`)
	p.Exec(ctx, `UPDATE brand_licensees SET status = 'suspended' WHERE licence = 'NG-0051'`)
	c, _ = st.Verify(ctx, "EC-QR-TEND-0001", brand.Place{}, "")
	p.Exec(ctx, `UPDATE brand_licensees SET status = 'active' WHERE licence = 'NG-0051'`)
	if c.Genuine || c.Reason != "ended" {
		t.Fatalf("ended = %+v", c)
	}

	// Reports.
	if _, err := st.Send(ctx, ada, brand.New{Place: "moon", Link: "x.shop", Selling: "tees"}); !errors.Is(err, brand.ErrBadInput) {
		t.Fatalf("bad place: %v", err)
	}
	if _, err := st.Send(ctx, ada, brand.New{Place: "online", Link: "x.shop", Selling: "tees", Photos: []string{"../etc/passwd"}}); !errors.Is(err, brand.ErrBadInput) {
		t.Fatalf("bad photo: %v", err)
	}
	r1, err := st.Send(ctx, ada, brand.New{Place: "online", Link: "ecinema-store-ng.shop", Selling: "Tees and caps", Country: "ng", Anonymous: true,
		Photos: []string{"reports/7d0f6c1e-1111-4222-8333-444455556666.jpg"}, AINote: "No hologram visible"})
	if err != nil || r1.Status != "sent" || r1.Country != "NG" || len(r1.Photos) != 1 {
		t.Fatalf("send = %+v, %v", r1, err)
	}
	r2, _ := st.Send(ctx, ada, brand.New{Place: "market", Link: "Balogun market stall 14", Selling: "VR headsets", Country: "NG"})
	r3, _ := st.Send(ctx, kim, brand.New{Place: "social", Link: "instagram.com/ecin3ma", Selling: "Caps", Country: "NG"})

	open, err := st.Open(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range open {
		if r.ID == r1.ID && r.Reporter != "" {
			t.Fatal("anonymous reporter shown to staff")
		}
		if r.ID == r3.ID && r.Reporter == "" {
			t.Fatal("named reporter hidden")
		}
	}

	if _, err := st.Decide(ctx, r1.ID, brand.Decision{Status: "confirmed", RewardNGN: 100, CreditCents: 10}); !errors.Is(err, brand.ErrBadInput) {
		t.Fatalf("tiny reward: %v", err)
	}
	if _, err := st.Decide(ctx, r2.ID, brand.Decision{Status: "checking"}); err != nil {
		t.Fatal(err)
	}
	d, err := st.Decide(ctx, r1.ID, brand.Decision{Status: "confirmed", Outcome: "taken down", RewardNGN: 10000, CreditCents: 650})
	if err != nil || d.Points != 500 || d.DecidedAt == nil {
		t.Fatalf("confirm = %+v, %v", d, err)
	}
	if _, err := st.Decide(ctx, r1.ID, brand.Decision{Status: "confirmed", RewardNGN: 10000, CreditCents: 650}); !errors.Is(err, brand.ErrDecided) {
		t.Fatalf("paid twice: %v", err)
	}
	var credit int
	p.QueryRow(ctx, `SELECT coalesce(sum(delta_cents), 0) FROM credits WHERE account_id = $1 AND ref LIKE 'brand:%'`, ada).Scan(&credit)
	if credit != 650 {
		t.Fatalf("credit = %d", credit)
	}
	st.Decide(ctx, r3.ID, brand.Decision{Status: "confirmed", RewardNGN: 5000, CreditCents: 320})

	s, err := st.Rewards(ctx, ada, "")
	if err != nil || s.Points != 500 || s.MonthPoints != 500 || s.Sent != 2 || s.Confirmed != 1 || s.RewardNGN != 10000 || s.Country != "NG" || s.Rank < 1 || len(s.Reports) != 2 {
		t.Fatalf("rewards = %+v, %v", s, err)
	}
	if len(s.Top) == 0 || s.Top[0].Name != "Adaeze O." || !s.Top[0].Me {
		t.Fatalf("top = %+v", s.Top)
	}
	k, _ := st.Rewards(ctx, kim, "")
	if k.Rank <= s.Rank {
		t.Fatalf("kim rank %d vs ada %d", k.Rank, s.Rank)
	}

	// A made-up report costs points; five a day at most.
	st.Decide(ctx, r2.ID, brand.Decision{Status: "false"})
	if s, _ = st.Rewards(ctx, ada, ""); s.Points != 300 {
		t.Fatalf("after false = %d", s.Points)
	}
	for i := 0; i < 3; i++ {
		st.Send(ctx, ada, brand.New{Place: "online", Link: "a.shop", Selling: "tees"})
	}
	if _, err := st.Send(ctx, ada, brand.New{Place: "online", Link: "a.shop", Selling: "tees"}); !errors.Is(err, brand.ErrTooMany) {
		t.Fatalf("sixth report: %v", err)
	}
}
