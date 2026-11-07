package licensing_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/db"
	"github.com/Bolajiomo99/E-Cinema/api/internal/licensing"
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

func TestLicensing(t *testing.T) {
	p := pool(t)
	ctx := context.Background()
	st := licensing.Store{DB: p}
	owner := account(t, p, "lic-owner@example.com", "Bisi Adeyemi")
	staff := account(t, p, "lic-staff@example.com", "Tunde Bello")
	clean := func() {
		var lic *string
		p.QueryRow(ctx, `SELECT licence FROM licence_applications WHERE account_id = $1`, owner).Scan(&lic)
		p.Exec(ctx, `DELETE FROM licence_applications WHERE account_id = $1`, owner)
		if lic != nil {
			p.Exec(ctx, `DELETE FROM shop_products WHERE licence = $1`, *lic)
			p.Exec(ctx, `DELETE FROM brand_scans WHERE code IN (SELECT code FROM brand_codes WHERE licence = $1)`, *lic)
			p.Exec(ctx, `DELETE FROM brand_codes WHERE licence = $1`, *lic)
			p.Exec(ctx, `DELETE FROM brand_licensees WHERE licence = $1`, *lic)
		}
	}
	clean()
	t.Cleanup(clean)

	if _, err := st.App(ctx, owner); !errors.Is(err, licensing.ErrNotFound) {
		t.Fatalf("no app: %v", err)
	}
	if _, err := st.Save(ctx, owner, licensing.Draft{Plan: "starter", Country: "NG", Countries: []string{"NG", "GH"}}); !errors.Is(err, licensing.ErrBadInput) {
		t.Fatalf("starter with two countries: %v", err)
	}
	a, err := st.Save(ctx, owner, licensing.Draft{Plan: "growth", Company: "Yaba Prints Ltd", RegNumber: "RC 1234567", Country: "ng", City: "Lagos", Website: "YabaPrints.ng", Countries: []string{"NG", "gh", "NG"}})
	if err != nil || a.Status != "draft" || len(a.Countries) != 2 || a.Website != "yabaprints.ng" {
		t.Fatalf("save = %+v, %v", a, err)
	}
	if _, err := st.Submit(ctx, owner, true); !errors.Is(err, licensing.ErrBadInput) {
		t.Fatalf("submit without papers: %v", err)
	}
	if _, err := st.SetDoc(ctx, owner, "../x.pdf", "", false); !errors.Is(err, licensing.ErrBadInput) {
		t.Fatalf("bad doc key: %v", err)
	}
	st.SetDoc(ctx, owner, "licensing/11111111-2222-4333-8444-555555555555.pdf", "Certificate for Yaba Prints Ltd, RC 1234567", true)
	st.SetPhotos(ctx, owner, []string{"licensing/11111111-2222-4333-8444-555555555556.jpg"})
	if _, err := st.Submit(ctx, owner, false); !errors.Is(err, licensing.ErrBadInput) {
		t.Fatalf("submit without face check: %v", err)
	}
	a, err = st.Submit(ctx, owner, true)
	if err != nil || a.Status != "submitted" {
		t.Fatalf("submit = %+v, %v", a, err)
	}
	if _, err := st.Save(ctx, owner, licensing.Draft{Plan: "growth", Country: "NG"}); !errors.Is(err, licensing.ErrState) {
		t.Fatalf("edit after submit: %v", err)
	}
	if _, err := st.Review(ctx, a.ID, false, "", 0); !errors.Is(err, licensing.ErrBadInput) {
		t.Fatalf("reject without reason: %v", err)
	}
	a, err = st.Review(ctx, a.ID, true, "Welcome", 0)
	if err != nil || a.Status != "approved" || a.FeeNGN != 1200000 {
		t.Fatalf("approve = %+v, %v", a, err)
	}
	if err := st.AttachPayment(ctx, owner, "LICTEST1"); err != nil {
		t.Fatal(err)
	}
	if none, _ := st.MarkPaid(ctx, "NOT-A-LICENCE"); none != nil {
		t.Fatal("unknown order matched")
	}
	paid, err := st.MarkPaid(ctx, "LICTEST1")
	if err != nil || paid == nil || paid.Status != "active" || paid.Licence == nil {
		t.Fatalf("paid = %+v, %v", paid, err)
	}
	if again, _ := st.MarkPaid(ctx, "LICTEST1"); again == nil || *again.Licence != *paid.Licence {
		t.Fatal("second capture made another licence")
	}

	l, err := st.For(ctx, owner)
	if err != nil || l.Role != "owner" || l.Plan.RoyaltyPct != 6 || l.Licence != *paid.Licence {
		t.Fatalf("for = %+v, %v", l, err)
	}
	// Team: invite by email, claimed on sign-in, staff cannot invite.
	if err := st.AddMember(ctx, l, "LIC-staff@example.com"); err != nil {
		t.Fatal(err)
	}
	ls, err := st.For(ctx, staff)
	if err != nil || ls.Role != "staff" {
		t.Fatalf("staff = %+v, %v", ls, err)
	}
	if err := st.AddMember(ctx, ls, "x@example.com"); !errors.Is(err, licensing.ErrForbidden) {
		t.Fatalf("staff invite: %v", err)
	}
	if m, _ := st.Members(ctx, l.Licence); len(m) != 2 || !m[1].Joined {
		t.Fatalf("members = %+v", m)
	}

	// Products: approval, shop listing for Growth, labels only for approved products.
	if _, err := st.AddProduct(ctx, l, licensing.NewProduct{Name: "Premiere tee", PriceNGN: 7500}); !errors.Is(err, licensing.ErrBadInput) {
		t.Fatalf("no picture: %v", err)
	}
	pr, err := st.AddProduct(ctx, l, licensing.NewProduct{Name: "Premiere tee, black", Detail: "Sizes S to XXL", PriceNGN: 7500, ImageKey: "licensing/11111111-2222-4333-8444-555555555557.png",
		Checks: []licensing.Check{{Name: "Logo colour and spacing", Detail: "Matches the brand guide", Result: "pass"}}})
	if err != nil || pr.Status != "review" || len(pr.Checks) != 1 {
		t.Fatalf("add = %+v, %v", pr, err)
	}
	if _, _, err := st.Issue(ctx, l, pr.ID, 10); !errors.Is(err, licensing.ErrBadInput) {
		t.Fatalf("labels before approval: %v", err)
	}
	if q, _ := st.ProductQueue(ctx); len(q) == 0 {
		t.Fatal("queue empty")
	}
	pr, err = st.DecideProduct(ctx, pr.ID, "live", "")
	if err != nil || pr.Status != "live" || pr.LiveAt == nil {
		t.Fatalf("decide = %+v, %v", pr, err)
	}
	var inShop bool
	p.QueryRow(ctx, `SELECT active FROM shop_products WHERE licence = $1`, l.Licence).Scan(&inShop)
	if !inShop {
		t.Fatal("not listed in the shop")
	}
	batch, codes, err := st.Issue(ctx, l, pr.ID, 50)
	if err != nil || len(codes) != 50 || batch == "" {
		t.Fatalf("issue = %d %s, %v", len(codes), batch, err)
	}
	again, product, err := st.Batch(ctx, l, batch)
	if err != nil || len(again) != 50 || product != "Premiere tee, black" {
		t.Fatalf("batch = %d %s, %v", len(again), product, err)
	}

	// Sales and the numbers built from them.
	now := time.Now()
	if _, err := st.AddSales(ctx, l, []licensing.Sale{{ProductID: pr.ID, Channel: "own", Country: "US", Qty: 1, AmountNGN: 7500}}); !errors.Is(err, licensing.ErrBadInput) {
		t.Fatalf("country outside licence: %v", err)
	}
	if _, err := st.AddSales(ctx, l, []licensing.Sale{{ProductID: pr.ID, Channel: "shop", Country: "NG", Qty: 1, AmountNGN: 7500}}); !errors.Is(err, licensing.ErrBadInput) {
		t.Fatalf("partner adding shop sales: %v", err)
	}
	n, err := st.AddSales(ctx, l, []licensing.Sale{
		{Product: "premiere tee, black", Channel: "own", Country: "NG", City: "Lagos", Qty: 4, AmountNGN: 30000, Buyer: "b1", Ref: "INV-1"},
		{ProductID: pr.ID, Channel: "stall", Country: "NG", City: "Abuja", Qty: 2, AmountNGN: 15000, Film: "Red Earth", Buyer: "b1", Ref: "INV-2", SoldAt: now.Add(-2 * time.Hour)},
		{ProductID: pr.ID, Channel: "wholesale", Country: "GH", City: "Accra", Qty: 10, AmountNGN: 60000, Buyer: "b2", Ref: "INV-3"},
	})
	if err != nil || n != 3 {
		t.Fatalf("add sales = %d, %v", n, err)
	}
	if n, _ := st.AddSales(ctx, l, []licensing.Sale{{ProductID: pr.ID, Channel: "own", Country: "NG", Qty: 4, AmountNGN: 30000, Ref: "INV-1"}}); n != 0 {
		t.Fatal("same invoice counted twice")
	}
	now = time.Now().Add(time.Second)
	o, err := st.Overview(ctx, l, now)
	if err != nil || o.SalesNGN != 105000 || o.Items != 16 || len(o.Daily) != 30 || len(o.Channels) != 3 || o.RoyaltyNGN != 6300 || len(o.Top) != 1 || o.Top[0].Tag != "Best seller" {
		t.Fatalf("overview = %+v, %v", o, err)
	}
	bk, err := st.Book(ctx, now)
	if err != nil || bk.Partners < 1 || bk.Plans["growth"] < 1 || bk.ByCountry["NG"] < 1 {
		t.Fatalf("book = %+v, %v", bk, err)
	}
	found := false
	for _, r := range bk.Rows {
		if r.Licence == l.Licence {
			found = r.Sales30NGN == 105000 && r.Plan == "growth" && r.Compliance > 0
		}
	}
	if !found {
		t.Fatalf("book rows = %+v", bk.Rows)
	}
	an, err := st.Analytics(ctx, l, now, licensing.Filter{Days: 90})
	if err != nil || an.Orders != 3 || an.RepeatPct != 50 || len(an.ByCountry) != 2 || an.ByCountry[0].Name != "GH" || len(an.ByFilm) != 2 {
		t.Fatalf("analytics = %+v, %v", an, err)
	}
	// A copied label shows up as suspicious; codes summary counts first scans.
	for _, city := range []string{"Lagos", "Kano", "Kaduna", "Onitsha"} {
		p.Exec(ctx, `INSERT INTO brand_scans (code, issued, city, country) VALUES ($1, true, $2, 'NG')`, codes[0], city)
	}
	p.Exec(ctx, `UPDATE brand_codes SET first_scan_at = now(), scans = 4 WHERE code = $1`, codes[0])
	c, err := st.Codes(ctx, l, now)
	ours := false
	for _, s := range c.List {
		ours = ours || (s.Ours && s.Code == codes[0] && len(s.Cities) == 4)
	}
	if err != nil || c.Issued != 50 || c.OnSold != 16 || c.Genuine != 1 || !ours || len(c.Batches) != 1 {
		t.Fatalf("codes = %+v, %v", c, err)
	}
	if o, _ := st.Overview(ctx, l, now); len(o.Alerts) == 0 || o.Alerts[0].Kind != "action" {
		t.Fatalf("alerts = %+v", o.Alerts)
	}
	r, err := st.Royalties(ctx, l, now)
	if err != nil || len(r.Statements) != 1 || r.Current.Status != "open" || r.Current.RoyaltyNGN != 6300 {
		t.Fatalf("royalties = %+v, %v", r, err)
	}
	cp, err := st.Compliance(ctx, l)
	if err != nil || cp.Score != 96 || cp.SamplesTotal != 1 {
		t.Fatalf("compliance = %+v, %v", cp, err)
	}
	// Payout account needs the face check; a matching name is verified.
	if err := st.SetPayout(ctx, l, "Zenith Bank", "0123454410", "Yaba Prints Ltd", false); !errors.Is(err, licensing.ErrBadInput) {
		t.Fatalf("payout without face check: %v", err)
	}
	if err := st.SetPayout(ctx, l, "Zenith Bank", "0123454410", "Yaba Prints Ltd", true); err != nil {
		t.Fatal(err)
	}
	if l, _ = st.For(ctx, owner); !l.PayoutVerified || l.PayoutLast4 != "4410" || l.PayoutHold == nil {
		t.Fatalf("payout = %+v", l)
	}
	if err := st.Settings(ctx, l, "Lagos", "https://www.yabaprints.ng/"); err != nil {
		t.Fatal(err)
	}
	// Renewal: a year from the current end date, on the same or a bigger plan; repeats are no-ops.
	ls, _ = st.For(ctx, staff)
	if err := st.StartRenewal(ctx, ls, staff, "growth", "RENEWTEST1"); !errors.Is(err, licensing.ErrForbidden) {
		t.Fatalf("staff renewing: %v", err)
	}
	if _, err := licensing.RenewalQuote(l, "global"); !errors.Is(err, licensing.ErrBadInput) {
		t.Fatalf("global quote: %v", err)
	}
	p.Exec(ctx, `DELETE FROM licence_renewals WHERE order_id = 'RENEWTEST1'`)
	if err := st.StartRenewal(ctx, l, owner, l.Plan.ID, "RENEWTEST1"); err != nil {
		t.Fatal(err)
	}
	rn, err := st.MarkRenewed(ctx, "RENEWTEST1")
	if err != nil || rn == nil || !rn.ValidUntil.Equal(l.ValidUntil.AddDate(0, 0, 365)) {
		t.Fatalf("renewed = %+v, %v (was %v)", rn, err, l.ValidUntil)
	}
	if again, _ := st.MarkRenewed(ctx, "RENEWTEST1"); again == nil || !again.ValidUntil.Equal(rn.ValidUntil) {
		t.Fatalf("repeat renewal = %+v", again)
	}
	if none, _ := st.MarkRenewed(ctx, "NOT-A-RENEWAL"); none != nil {
		t.Fatal("unknown renewal matched")
	}
	// Last month's royalty (email 41): quoted, paid through PayPal and settled.
	this := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	last := this.AddDate(0, -1, 0)
	p.Exec(ctx, `UPDATE licence_sales SET sold_at = $2 WHERE licence = $1`, l.Licence, last.Add(48*time.Hour))
	p.Exec(ctx, `DELETE FROM licence_settlements WHERE licence = $1`, l.Licence)
	p.Exec(ctx, `DELETE FROM mail_outbox WHERE dedupe LIKE 'royalty:' || $1 || ':%'`, l.Licence)
	if _, err := st.QuoteRoyalty(ctx, l, this.Format("2006-01")); !errors.Is(err, licensing.ErrBadInput) {
		t.Fatalf("current month quote: %v", err)
	}
	l, _ = st.For(ctx, owner)
	q, err := st.QuoteRoyalty(ctx, l, last.Format("2006-01"))
	if err != nil || q.SalesNGN != 105000 || q.RoyaltyNGN != 105000*int64(l.Plan.RoyaltyPct)/100 || q.Invoice != licensing.InvoiceNo(l.Licence, last) {
		t.Fatalf("quote = %+v, %v", q, err)
	}
	if n, err := st.QueueStatements(ctx, this.Add(7*time.Hour)); err != nil || n != 0 {
		t.Fatalf("before 08:00: %d %v", n, err)
	}
	if _, err := st.QueueStatements(ctx, this.Add(9*time.Hour)); err != nil {
		t.Fatal(err)
	}
	var data string
	if err := p.QueryRow(ctx, `SELECT data->>'invoice' FROM mail_outbox WHERE kind = 'royalty_statement' AND dedupe = 'royalty:' || $1 || ':' || $2`, l.Licence, last.Format("2006-01")).Scan(&data); err != nil || data != q.Invoice {
		t.Fatalf("statement mail: %q %v", data, err)
	}
	p.Exec(ctx, `DELETE FROM licence_royalty_payments WHERE order_id = 'ROYTEST1'`)
	if err := st.StartRoyaltyPayment(ctx, l, owner, last.Format("2006-01"), "ROYTEST1"); err != nil {
		t.Fatal(err)
	}
	rp, err := st.MarkRoyaltyPaid(ctx, "ROYTEST1")
	if err != nil || rp == nil || rp.Licence != l.Licence || !rp.Month.Equal(last) {
		t.Fatalf("royalty paid = %+v, %v", rp, err)
	}
	if again, err := st.MarkRoyaltyPaid(ctx, "ROYTEST1"); err != nil || again == nil {
		t.Fatalf("repeat capture = %+v, %v", again, err)
	}
	if none, _ := st.MarkRoyaltyPaid(ctx, "NOT-A-ROYALTY"); none != nil {
		t.Fatal("unknown royalty matched")
	}
	if _, err := st.QuoteRoyalty(ctx, l, last.Format("2006-01")); !errors.Is(err, licensing.ErrBadInput) {
		t.Fatalf("settled month quote: %v", err)
	}
	// A compliance case (email 43): opened by the brand team, fixed by the partner, then closed.
	if _, err := st.OpenCase(ctx, l.Licence, "", "Kano", "x", 14); !errors.Is(err, licensing.ErrBadInput) {
		t.Fatalf("empty case: %v", err)
	}
	cs, err := st.OpenCase(ctx, l.Licence, "unlabelled caps", "Kano", "Our investigator bought 6 caps at your Kano stall with no authenticity label.", 14)
	if err != nil || cs.Number != licensing.CaseNumber(cs.ID) || cs.Status != "open" || cs.FixBy != time.Now().AddDate(0, 0, 14).Format("2006-01-02") {
		t.Fatalf("case = %+v, %v", cs, err)
	}
	if cp, _ := st.Compliance(ctx, l); cp.Unapproved != 1 {
		t.Fatalf("open case counted = %+v", cp)
	}
	if _, err := st.CaseFixed(ctx, l, cs.ID, ""); !errors.Is(err, licensing.ErrBadInput) {
		t.Fatalf("fixed without note: %v", err)
	}
	if got, err := st.CaseFixed(ctx, l, cs.ID, "Labelled every cap"); err != nil || got.Status != "fixed" {
		t.Fatalf("fixed = %+v, %v", got, err)
	}
	if got, err := st.DecideCase(ctx, cs.ID, "closed"); err != nil || got.Status != "closed" || got.ResolvedAt == nil {
		t.Fatalf("closed = %+v, %v", got, err)
	}
	if _, err := st.DecideCase(ctx, cs.ID, "suspended"); !errors.Is(err, licensing.ErrNotFound) {
		t.Fatalf("decided twice: %v", err)
	}
	if cp, _ := st.Compliance(ctx, l); cp.Unapproved != 0 {
		t.Fatalf("closed case still counted = %+v", cp)
	}
	cs2, _ := st.OpenCase(ctx, l.Licence, "sales abroad", "Accra", "Sold outside the licence countries.", 7)
	if got, err := st.DecideCase(ctx, cs2.ID, "suspended"); err != nil || got.Status != "suspended" {
		t.Fatalf("suspend = %+v, %v", got, err)
	}
	if l2, _ := st.For(ctx, owner); l2.Status != "suspended" {
		t.Fatalf("licence status = %s", l2.Status)
	}
	p.Exec(ctx, `UPDATE brand_licensees SET status = 'active' WHERE licence = $1`, l.Licence)
}
