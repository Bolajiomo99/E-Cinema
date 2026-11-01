package gifts_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/db"
	"github.com/Bolajiomo99/E-Cinema/api/internal/gifts"
	"github.com/Bolajiomo99/E-Cinema/api/internal/tickets"
)

func store(t *testing.T) gifts.Store {
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
	return gifts.Store{DB: p}
}

func acct(t *testing.T, s gifts.Store, email string) string {
	t.Helper()
	var id string
	if err := s.DB.QueryRow(context.Background(), `INSERT INTO accounts (email, name, password_hash) VALUES ($1, 'G', 'x')
	  ON CONFLICT (email) DO UPDATE SET plan = 'free', plan_status = 'active', paypal_subscription_id = NULL, plan_gift_until = NULL RETURNING id`, email).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestGifts(t *testing.T) {
	s := store(t)
	ctx := context.Background()
	clean := func() {
		s.DB.Exec(ctx, `DELETE FROM credits WHERE account_id IN (SELECT id FROM accounts WHERE email LIKE 'gift-%@example.com')`)
		s.DB.Exec(ctx, `DELETE FROM gifts WHERE giver_id IN (SELECT id FROM accounts WHERE email LIKE 'gift-%@example.com')`)
		s.DB.Exec(ctx, `DELETE FROM holds WHERE showtime_id = 'gift-test'`)
	}
	clean()
	t.Cleanup(clean)
	if _, err := s.DB.Exec(ctx, `INSERT INTO showtimes VALUES ('gift-test', 'Gift Film', 'S', now() + interval '2 days', 90, 10, 500, 'USD') ON CONFLICT (id) DO UPDATE SET starts_at = EXCLUDED.starts_at`); err != nil {
		t.Fatal(err)
	}
	giver, ada, payer := acct(t, s, "gift-giver@example.com"), acct(t, s, "gift-ada@example.com"), acct(t, s, "gift-payer@example.com")

	if _, err := s.Create(ctx, giver, gifts.New{Kind: "credit", AmountCents: 1000, Currency: "USD", Name: "Ada", To: "not an address", OrderID: "G-0"}); !errors.Is(err, gifts.ErrBadInput) {
		t.Fatalf("bad recipient: %v", err)
	}
	// Credit, delivered tomorrow.
	c, err := s.Create(ctx, giver, gifts.New{Kind: "credit", AmountCents: 1000, Currency: "USD", Name: "Ada", To: "Ada@Example.com", Message: "Happy birthday!", DeliverAt: time.Now().Add(24 * time.Hour), OrderID: "G-CREDIT"})
	if err != nil || c.Email != "ada@example.com" || len(c.Code) != 13 {
		t.Fatalf("credit gift = %+v, %v", c, err)
	}
	if _, err := s.Redeem(ctx, c.Code, ada); !errors.Is(err, gifts.ErrNotPaid) {
		t.Fatalf("redeem before payment: %v", err)
	}
	if ok, err := s.MarkPaid(ctx, "G-CREDIT", "CAP-G1"); !ok || err != nil {
		t.Fatalf("mark paid: %v %v", ok, err)
	}
	if due, _ := s.Due(ctx); len(due) != 0 {
		t.Fatalf("delivered early: %+v", due)
	}
	s.DB.Exec(ctx, `UPDATE gifts SET deliver_at = now() - interval '1 minute' WHERE paypal_order_id = 'G-CREDIT'`)
	if due, _ := s.Due(ctx); len(due) != 1 || due[0].Code != c.Code || due[0].GiverName != "G" {
		t.Fatalf("due = %+v", due)
	}
	if due, _ := s.Due(ctx); len(due) != 0 {
		t.Fatal("delivered twice")
	}
	if _, err := s.Redeem(ctx, c.Code, giver); !errors.Is(err, gifts.ErrOwnGift) {
		t.Fatalf("giver redeeming: %v", err)
	}
	if r, err := s.Redeem(ctx, " "+c.Code+" ", ada); err != nil || r.CreditCents != 1000 {
		t.Fatalf("redeem credit: %+v %v", r, err)
	}
	if _, err := s.Redeem(ctx, c.Code, ada); !errors.Is(err, gifts.ErrRedeemed) {
		t.Fatalf("redeem twice: %v", err)
	}
	if bal, _ := s.Balance(ctx, ada); bal != 1000 {
		t.Fatalf("balance = %d", bal)
	}

	// Pay a seat with credit; credit never goes below zero.
	var hold string
	if err := s.DB.QueryRow(ctx, `INSERT INTO holds (showtime_id, seats, viewer_ref, expires_at, account_id) VALUES ('gift-test', 1, 'v', now() + interval '10 minutes', $1) RETURNING id`, ada).Scan(&hold); err != nil {
		t.Fatal(err)
	}
	if err := s.PayWithCredit(ctx, ada, hold, 1200, 1100); !errors.Is(err, gifts.ErrNoCredit) {
		t.Fatalf("overspend: %v", err)
	}
	if err := s.PayWithCredit(ctx, ada, hold, 600, 550); err != nil {
		t.Fatal(err)
	}
	if err := s.PayWithCredit(ctx, ada, hold, 100, 90); !errors.Is(err, gifts.ErrHoldGone) {
		t.Fatalf("paying a paid hold: %v", err)
	}
	if bal, _ := s.Balance(ctx, ada); bal != 400 {
		t.Fatalf("balance after seat = %d", bal)
	}
	// Cancelling a seat paid with credit puts the credit back, once.
	for i := 0; i < 2; i++ {
		if c, err := s.RefundCredit(ctx, ada, hold); err != nil || c != 600 {
			t.Fatalf("refund credit #%d = %d, %v", i, c, err)
		}
	}
	if bal, _ := s.Balance(ctx, ada); bal != 1000 {
		t.Fatalf("balance after refund = %d", bal)
	}
	var st string
	s.DB.QueryRow(ctx, `SELECT status FROM holds WHERE id = $1`, hold).Scan(&st)
	if st != "refunded" {
		t.Fatalf("hold after credit refund = %s", st)
	}

	// A seat gift: the hold is bought without an owner and handed over on redeem.
	var gh string
	if err := s.DB.QueryRow(ctx, `INSERT INTO holds (showtime_id, seats, viewer_ref, expires_at, paypal_order_id) VALUES ('gift-test', 1, 'gift', now() + interval '10 minutes', 'G-SEAT') RETURNING id`).Scan(&gh); err != nil {
		t.Fatal(err)
	}
	seat, err := s.Create(ctx, giver, gifts.New{Kind: "seat", ShowtimeID: "gift-test", HoldID: gh, AmountCents: 532, Currency: "USD", Name: "Ada", To: "+44 7700 900123", OrderID: "G-SEAT"})
	if err != nil || seat.Phone != "+447700900123" {
		t.Fatalf("seat gift = %+v, %v", seat, err)
	}
	s.MarkPaid(ctx, "G-SEAT", "CAP-G2")
	s.DB.Exec(ctx, `UPDATE holds SET status = 'paid', paypal_capture_id = 'CAP-G2' WHERE id = $1`, gh)
	s.DB.Exec(ctx, `INSERT INTO holds (showtime_id, seats, viewer_ref, status, expires_at, account_id) VALUES ('gift-test', 1, 'own', 'paid', now(), $1)`, ada)
	if _, err := s.Redeem(ctx, seat.Code, ada); !errors.Is(err, gifts.ErrSeatInUse) {
		t.Fatalf("Ada already has a seat: %v", err)
	}
	if r, err := s.Redeem(ctx, seat.Code, payer); err != nil || r.ShowtimeID != "gift-test" {
		t.Fatalf("redeem seat: %+v %v", r, err)
	}
	var owner string
	s.DB.QueryRow(ctx, `SELECT account_id FROM holds WHERE id = $1`, gh).Scan(&owner)
	if owner != payer {
		t.Fatal("seat not handed over")
	}
	if _, err := (tickets.Store{DB: s.DB}).CanCancel(ctx, payer, gh); !errors.Is(err, tickets.ErrGiftedSeat) {
		t.Fatalf("a gifted seat must not refund the giver's payment to the recipient: %v", err)
	}

	// Plans: a month of Pro for someone on Free; credit for someone who already pays.
	pro, _ := s.Create(ctx, giver, gifts.New{Kind: "pro1", AmountCents: 799, Currency: "USD", Name: "Ada", To: "ada@example.com", OrderID: "G-PRO"})
	s.MarkPaid(ctx, "G-PRO", "CAP-G3")
	if r, err := s.Redeem(ctx, pro.Code, ada); err != nil || r.Plan != "pro" || r.Until == "" {
		t.Fatalf("redeem pro: %+v %v", r, err)
	}
	vip, _ := s.Create(ctx, giver, gifts.New{Kind: "vip3", AmountCents: 1287, Currency: "USD", Name: "P", To: "p@example.com", OrderID: "G-VIP"})
	s.MarkPaid(ctx, "G-VIP", "CAP-G4")
	s.DB.Exec(ctx, `UPDATE accounts SET plan = 'pro', paypal_subscription_id = 'I-SUB' WHERE id = $1`, payer)
	if r, err := s.Redeem(ctx, vip.Code, payer); err != nil || r.CreditCents != 1287 || r.Plan != "" {
		t.Fatalf("plan gift to a subscriber: %+v %v", r, err)
	}
	s.DB.Exec(ctx, `UPDATE accounts SET plan_gift_until = now() - interval '1 second' WHERE id = $1`, ada)
	if n, err := s.EndGiftPlans(ctx); err != nil || n < 1 {
		t.Fatalf("end gift plans: %d %v", n, err)
	}
	if list, err := s.Sent(ctx, giver); err != nil || len(list) != 4 {
		t.Fatalf("sent = %d, %v", len(list), err)
	}
}
