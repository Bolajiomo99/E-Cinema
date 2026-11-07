package shop_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"

	"github.com/Bolajiomo99/E-Cinema/api/internal/db"
	"github.com/Bolajiomo99/E-Cinema/api/internal/shop"
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

func account(t *testing.T, p *pgxpool.Pool, email, plan string) string {
	t.Helper()
	var id string
	err := p.QueryRow(context.Background(), `INSERT INTO accounts (email, name, password_hash, plan) VALUES ($1, 'Ada', '!', $2)
	  ON CONFLICT (email) DO UPDATE SET plan = $2 RETURNING id`, email, plan).Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestShop(t *testing.T) {
	p := pool(t)
	ctx := context.Background()
	st := shop.Store{DB: p}
	pro := account(t, p, "shop-pro@example.com", "pro")
	free := account(t, p, "shop-free@example.com", "free")
	clean := func() {
		for _, id := range []string{pro, free} {
			p.Exec(ctx, `DELETE FROM shop_reviews WHERE account_id = $1`, id)
			p.Exec(ctx, `DELETE FROM shop_orders WHERE account_id = $1`, id)
			p.Exec(ctx, `DELETE FROM shop_cart WHERE account_id = $1`, id)
			p.Exec(ctx, `DELETE FROM shop_addresses WHERE account_id = $1`, id)
		}
	}
	clean()
	t.Cleanup(clean)

	list, err := st.Products(ctx)
	if err != nil || len(list) < 15 || list[0].ID != "vr-headset" || len(list[0].Options) != 2 {
		t.Fatalf("products = %d %+v, %v", len(list), list[0], err)
	}

	// Variants must match the product's options; gift cards are not cart items.
	if err := st.SetQty(ctx, pro, "vr-headset", "Gold · 128 GB", 1, true); !errors.Is(err, shop.ErrBadInput) {
		t.Fatalf("bad variant: %v", err)
	}
	if err := st.SetQty(ctx, pro, "gift-card", "", 1, true); !errors.Is(err, shop.ErrBadInput) {
		t.Fatalf("gift card in cart: %v", err)
	}
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	// The Figma cart: VR headset, popcorn box and a T-shirt for a Pro member in Lagos.
	must(st.SetQty(ctx, pro, "vr-headset", "Black · 128 GB", 1, true))
	must(st.SetQty(ctx, pro, "popcorn-box", "Salted caramel · Zobo", 1, true))
	must(st.SetQty(ctx, pro, "logo-tshirt", "Black · L", 1, true))
	must(st.SetQty(ctx, pro, "logo-tshirt", "Black · L", 2, true))
	must(st.SetQty(ctx, pro, "logo-tshirt", "Black · L", 1, false))

	q, err := st.Quote(ctx, pro, "NG")
	if err != nil {
		t.Fatal(err)
	}
	if q.Count != 3 || q.ItemsNGN != 309500 || q.DiscountNGN != 15475 || q.DeliveryNGN != 2500 || q.VATNGN != 22240 || q.TotalNGN != 318765 {
		t.Fatalf("quote = %+v", q)
	}
	if q.Suggestion == nil || q.Suggestion.ProductID != "over-ear-headset" || q.COD {
		t.Fatalf("suggestion/cod = %+v %v", q.Suggestion, q.COD)
	}
	if _, err := st.Place(ctx, pro, shop.Placing{Method: "cod", ExpectTotalNGN: q.TotalNGN}); !errors.Is(err, shop.ErrNoAddress) {
		t.Fatalf("no address: %v", err)
	}

	// An Abuja address cannot take Lagos same-day snacks; Lagos can, and opens pay on delivery.
	if _, err := st.SaveAddress(ctx, pro, shop.Address{Name: "Ada", Phone: "+234 801 234 5678", Line1: "1 Wuse", City: "Abuja", Country: "NG"}); err != nil {
		t.Fatal(err)
	}
	q, _ = st.Quote(ctx, pro, "")
	if len(q.Problems) != 1 || q.COD {
		t.Fatalf("abuja = %+v", q.Problems)
	}
	if _, err := st.SaveAddress(ctx, pro, shop.Address{Name: "Ada", Phone: "abc", Line1: "14 Admiralty Way", City: "Lagos", Country: "NG"}); !errors.Is(err, shop.ErrBadInput) {
		t.Fatalf("bad phone: %v", err)
	}
	if _, err := st.SaveAddress(ctx, pro, shop.Address{Name: "Ada", Phone: "+234 801 234 5678", Line1: "14 Admiralty Way", Area: "Lekki", City: "Lagos", Country: "ng"}); err != nil {
		t.Fatal(err)
	}
	must(st.SetQty(ctx, pro, "over-ear-headset", "Black", 1, true))
	q, _ = st.Quote(ctx, pro, "")
	if !q.COD || len(q.Problems) != 0 || q.BundleNGN != shop.BundleSaving || q.Suggestion != nil {
		t.Fatalf("lagos = %+v", q)
	}
	if _, err := st.Place(ctx, pro, shop.Placing{Method: "cod", ExpectTotalNGN: q.TotalNGN - 1}); !errors.Is(err, shop.ErrPriceMoved) {
		t.Fatalf("stale total: %v", err)
	}

	// PayPal: pending until captured, then placed and the bought lines leave the cart.
	o, err := st.Place(ctx, pro, shop.Placing{Method: "paypal", ExpectTotalNGN: q.TotalNGN, ChargeCurrency: "USD", ChargeCents: 21000, PayPalOrderID: "SHOPTEST1"})
	if err != nil || o.Status != "pending" || len(o.Items) != 4 || o.Address.Country != "NG" {
		t.Fatalf("paypal order = %+v, %v", o, err)
	}
	if mine, _ := st.Orders(ctx, pro); len(mine) != 0 {
		t.Fatal("pending order listed")
	}
	paid, err := st.MarkPaid(ctx, "SHOPTEST1", "CAP1")
	if err != nil || paid == nil || paid.Status != "placed" {
		t.Fatalf("mark paid = %+v, %v", paid, err)
	}
	if again, _ := st.MarkPaid(ctx, "SHOPTEST1", "CAP1"); again == nil {
		t.Fatal("repeat capture not recognised")
	}
	if none, _ := st.MarkPaid(ctx, "NOT-A-SHOP-ORDER", "CAP2"); none != nil {
		t.Fatal("unknown order matched")
	}
	if c, _ := st.Cart(ctx, pro); len(c) != 0 {
		t.Fatalf("cart after paying = %+v", c)
	}

	// The delivery team moves it along; the buyer cannot cancel once it is packed.
	if _, err := st.Advance(ctx, paid.Number, "delivered", nil); !errors.Is(err, shop.ErrBadInput) {
		t.Fatalf("skipping steps: %v", err)
	}
	must2 := func(o shop.Order, err error) shop.Order {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		return o
	}
	must2(st.Advance(ctx, paid.Number, "packed", nil))
	if _, err := st.Cancel(ctx, pro, paid.ID); !errors.Is(err, shop.ErrTooLate) {
		t.Fatalf("cancel after packing: %v", err)
	}
	out := must2(st.Advance(ctx, paid.Number, "out", &shop.Rider{Name: "Musa", Vehicle: "Honda bike", Plate: "LAG 482 KJ"}))
	if out.Rider == nil || out.Rider.Name != "Musa" || out.OutAt == nil {
		t.Fatalf("out = %+v", out)
	}
	open, _ := st.Open(ctx)
	found := false
	for _, o := range open {
		found = found || (o.ID == paid.ID && o.Buyer == "shop-pro@example.com")
	}
	if !found {
		t.Fatalf("open orders = %d", len(open))
	}

	// Reviews only from people who received the item.
	if err := st.Review(ctx, pro, "vr-headset", 5, "Front row every night"); !errors.Is(err, shop.ErrNotBuyer) {
		t.Fatalf("review before delivery: %v", err)
	}
	must2(st.Advance(ctx, paid.Number, "delivered", nil))
	must(st.Review(ctx, pro, "vr-headset", 5, "Front row every night"))
	if p, _ := st.Product(ctx, "vr-headset"); p.Reviews < 1 || p.Stars == 0 {
		t.Fatalf("rating = %+v", p)
	}
	ret := must2(st.Return(ctx, pro, paid.ID, "Too big for me"))
	if ret.Status != "returning" {
		t.Fatalf("return = %+v", ret)
	}

	// Reorder puts it all back; pay on delivery is placed straight away and empties the cart.
	if n, err := st.Reorder(ctx, pro, paid.ID); err != nil || n != 4 {
		t.Fatalf("reorder = %d, %v", n, err)
	}
	q, _ = st.Quote(ctx, pro, "")
	cod := must2(st.Place(ctx, pro, shop.Placing{Method: "cod", ExpectTotalNGN: q.TotalNGN}))
	if cod.Status != "placed" || cod.ChargeCurrency != "NGN" || cod.Number == paid.Number {
		t.Fatalf("cod = %+v", cod)
	}
	if c, _ := st.Cart(ctx, pro); len(c) != 0 {
		t.Fatal("cart not emptied")
	}
	if _, err := st.Cancel(ctx, free, cod.ID); !errors.Is(err, shop.ErrTooLate) {
		t.Fatalf("someone else cancelling: %v", err)
	}

	// Paystack and Flutterwave: charged in naira on the provider's page, pending until confirmed.
	if _, err := st.Reorder(ctx, pro, paid.ID); err != nil {
		t.Fatal(err)
	}
	q, _ = st.Quote(ctx, pro, "")
	if _, err := st.Place(ctx, pro, shop.Placing{Method: "paystack", ExpectTotalNGN: q.TotalNGN, ChargeCents: q.TotalNGN * 100, PayPalOrderID: "FLW-00000000000000000001"}); !errors.Is(err, shop.ErrBadInput) {
		t.Fatalf("wrong reference prefix: %v", err)
	}
	ps := must2(st.Place(ctx, pro, shop.Placing{Method: "paystack", ExpectTotalNGN: q.TotalNGN, ChargeCurrency: "USD", ChargeCents: q.TotalNGN * 100, PayPalOrderID: "PSK-00000000000000000001"}))
	if ps.Status != "pending" || ps.ChargeCurrency != "NGN" {
		t.Fatalf("paystack order = %+v", ps)
	}
	if got, err := st.MarkPaid(ctx, "PSK-00000000000000000001", "PSK-00000000000000000001~4242"); err != nil || got == nil || got.Status != "placed" {
		t.Fatalf("paystack paid = %+v, %v", got, err)
	}
	if c, _ := st.Cart(ctx, pro); len(c) != 0 {
		t.Fatal("cart not emptied after Paystack")
	}

	// Pay in 6: first part on Paystack, the saved card pays the rest a month apart.
	if _, err := st.Reorder(ctx, pro, paid.ID); err != nil {
		t.Fatal(err)
	}
	q, _ = st.Quote(ctx, pro, "")
	if q.TotalNGN < shop.InstalmentMinNGN {
		t.Fatalf("total %d too small for the instalment test", q.TotalNGN)
	}
	ins := must2(st.Place(ctx, pro, shop.Placing{Method: "instalments", ExpectTotalNGN: q.TotalNGN, PayPalOrderID: "PSK-00000000000000000002"}))
	if ins.Status != "pending" || ins.ChargeCents != shop.FirstPart(q.TotalNGN)*100 || ins.Plan == nil || ins.Plan.Status != "waiting" {
		t.Fatalf("instalment order = %+v plan %+v", ins, ins.Plan)
	}
	if err := st.StartPlan(ctx, "PSK-00000000000000000002", "AUTH_test1", "shop-pro@example.com"); err != nil {
		t.Fatal(err) // not paid yet: nothing to start, but the plan exists
	}
	must2(ptr(st.MarkPaid(ctx, "PSK-00000000000000000002", "PSK-00000000000000000002~77")))
	if err := st.StartPlan(ctx, "PSK-00000000000000000002", "nope", "shop-pro@example.com"); !errors.Is(err, shop.ErrBadInput) {
		t.Fatalf("bad auth code: %v", err)
	}
	must(st.StartPlan(ctx, "PSK-00000000000000000002", "AUTH_test1", "shop-pro@example.com"))
	if due, _ := st.DueParts(ctx, 50); len(due) != 0 {
		t.Fatalf("due before a month: %+v", due)
	}
	if _, err := p.Exec(ctx, `UPDATE shop_instalments SET next_due = now() - interval '1 minute' WHERE order_id = $1`, ins.ID); err != nil {
		t.Fatal(err)
	}
	var mine shop.DuePart
	due, _ := st.DueParts(ctx, 50)
	for _, d := range due {
		if d.OrderID == ins.ID {
			mine = d
		}
	}
	if mine.Part != 2 || mine.AuthCode != "AUTH_test1" || mine.AmountNGN != shop.FirstPart(q.TotalNGN) {
		t.Fatalf("due = %+v", due)
	}
	o2 := must2(ptr(st.PartResult(ctx, ins.ID, 2, false, mine.Reference, "Insufficient funds")))
	if o2.Plan.Status != "active" || o2.Plan.Paid != 1 || o2.Plan.LastError == "" {
		t.Fatalf("after a failed part: %+v", o2.Plan)
	}
	for part := 2; part <= shop.InstalmentParts; part++ {
		o2 = must2(ptr(st.PartResult(ctx, ins.ID, part, true, fmt.Sprintf("ref-%d", part), "")))
	}
	if o2.Plan.Status != "done" || o2.Plan.PaidNGN != q.TotalNGN || o2.Plan.NextDue != nil {
		t.Fatalf("finished plan = %+v (total %d)", o2.Plan, q.TotalNGN)
	}
	must2(st.Cancel(ctx, pro, cod.ID))

	// A free member abroad: no discount, world delivery, no VAT, and Nigeria-only items flagged.
	must(st.SetQty(ctx, free, "umbrella", "", 1, true))
	must(st.SetQty(ctx, free, "premiere-cap", "Red", 1, true))
	q, _ = st.Quote(ctx, free, "US")
	if q.DiscountNGN != 0 || q.DeliveryNGN != shop.DeliveryWorld || q.VATNGN != 0 || len(q.Problems) != 1 {
		t.Fatalf("abroad = %+v", q)
	}
}

func ptr(o *shop.Order, err error) (shop.Order, error) {
	if o == nil {
		return shop.Order{}, err
	}
	return *o, err
}
