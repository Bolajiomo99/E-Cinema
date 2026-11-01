package shop_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/shop"
)

func TestJudge(t *testing.T) {
	now := time.Now()
	start := now.Add(-3 * time.Hour)
	late := now.Add(-2 * time.Hour)
	early := now.Add(-4 * time.Hour)
	snack := shop.Item{BeforeShow: true, StartsAt: &start}
	cases := []struct {
		name    string
		o       shop.Order
		reason  string
		instant bool
		err     error
	}{
		{"late after start", shop.Order{Status: "delivered", DeliveredAt: &late, TotalNGN: 6500, Items: []shop.Item{snack}}, "late", true, nil},
		{"on time", shop.Order{Status: "delivered", DeliveredAt: &early, TotalNGN: 6500, Items: []shop.Item{snack}}, "late", false, nil},
		{"small damaged", shop.Order{Status: "delivered", DeliveredAt: &late, TotalNGN: 6500}, "damaged", true, nil},
		{"big damaged", shop.Order{Status: "delivered", DeliveredAt: &late, TotalNGN: 250000}, "wrong", false, nil},
		{"never but delivered", shop.Order{Status: "delivered", DeliveredAt: &late, TotalNGN: 6500}, "never", false, nil},
		{"never, long out", shop.Order{Status: "out", OutAt: &early, TotalNGN: 6500}, "never", true, nil},
		{"never, just out", shop.Order{Status: "out", OutAt: &now, TotalNGN: 6500}, "never", false, shop.ErrBadInput},
		{"placed", shop.Order{Status: "placed"}, "late", false, shop.ErrTooLate},
		{"bad reason", shop.Order{Status: "delivered", DeliveredAt: &late}, "meh", false, shop.ErrBadInput},
	}
	for _, c := range cases {
		v, err := shop.Judge(c.o, c.reason, now)
		if c.err != nil {
			if !errors.Is(err, c.err) {
				t.Errorf("%s: err = %v", c.name, err)
			}
			continue
		}
		if err != nil || v.Instant != c.instant || v.Why == "" {
			t.Errorf("%s: %+v %v", c.name, v, err)
		}
	}
}

func TestRefundRequest(t *testing.T) {
	p := pool(t)
	ctx := context.Background()
	st := shop.Store{DB: p}
	me := account(t, p, "shop-refund@example.com", "free")
	clean := func() {
		p.Exec(ctx, `DELETE FROM credits WHERE account_id = $1`, me)
		p.Exec(ctx, `DELETE FROM shop_orders WHERE account_id = $1`, me)
		p.Exec(ctx, `DELETE FROM shop_cart WHERE account_id = $1`, me)
		p.Exec(ctx, `DELETE FROM shop_addresses WHERE account_id = $1`, me)
	}
	clean()
	t.Cleanup(clean)
	if _, err := st.SaveAddress(ctx, me, shop.Address{Name: "Ada", Phone: "+234 801 234 5678", Line1: "14 Admiralty Way", Area: "Lekki", City: "Lagos", Country: "NG"}); err != nil {
		t.Fatal(err)
	}
	if err := st.SetQty(ctx, me, "logo-tshirt", "Black · L", 1, true); err != nil {
		t.Fatal(err)
	}
	q, _ := st.Quote(ctx, me, "NG")
	o, err := st.Place(ctx, me, shop.Placing{Method: "cod", ExpectTotalNGN: q.TotalNGN})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := st.AskRefund(ctx, me, o.ID, "damaged", "", "refund", 500, time.Now()); !errors.Is(err, shop.ErrTooLate) {
		t.Fatalf("not delivered yet: %v", err)
	}
	for _, s := range []string{"packed", "out", "delivered"} {
		if _, err := st.Advance(ctx, o.Number, s, nil); err != nil {
			t.Fatal(err)
		}
	}
	big := q.TotalNGN > shop.InstantLimitNGN
	rf, _, err := st.AskRefund(ctx, me, o.ID, "damaged", "  Torn at the seam. ", "refund", 1234, time.Now())
	if err != nil || rf.Note != "Torn at the seam." || rf.AmountNGN != q.TotalNGN || (rf.Status == "approved") == big {
		t.Fatalf("ask = %+v %v (total %d)", rf, err, q.TotalNGN)
	}
	if _, _, err := st.AskRefund(ctx, me, o.ID, "wrong", "", "refund", 1234, time.Now()); !errors.Is(err, shop.ErrAlreadyAsked) {
		t.Fatalf("twice: %v", err)
	}
	if big {
		list, _ := st.PendingRefunds(ctx)
		found := false
		for _, r := range list {
			found = found || r.ID == rf.ID
		}
		if !found {
			t.Fatal("not in review queue")
		}
		if _, _, err := st.DecideRefund(ctx, rf.ID, true); err != nil {
			t.Fatal(err)
		}
		if _, _, err := st.DecideRefund(ctx, rf.ID, true); !errors.Is(err, shop.ErrNotFound) {
			t.Fatalf("decide twice: %v", err)
		}
	}
	var credit int
	p.QueryRow(ctx, `SELECT coalesce(sum(delta_cents), 0) FROM credits WHERE account_id = $1`, me).Scan(&credit)
	if credit != 1234 {
		t.Fatalf("wallet credit = %d", credit)
	}
	got, err := st.RefundFor(ctx, me, o.ID)
	if err != nil || got == nil || got.Status != "approved" {
		t.Fatalf("refund for = %+v %v", got, err)
	}
}
