// Package gifts sells and redeems gifts (Figma "Web / Gift a seat", 94:1398): a premiere seat,
// a month of Pro, three months of VIP, or credit, plus the credit ledger they feed.
package gifts

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrBadInput  = errors.New("invalid gift")
	ErrNotFound  = errors.New("gift not found")
	ErrNotPaid   = errors.New("this gift has not been paid for yet")
	ErrRedeemed  = errors.New("this gift has already been redeemed")
	ErrOwnGift   = errors.New("you cannot redeem a gift you bought; send the link to the person it is for")
	ErrNoCredit  = errors.New("not enough credit for this seat")
	ErrHoldGone  = errors.New("seat hold not found, expired or already paid")
	ErrSeatInUse = errors.New("you already have a seat for this premiere; pass the gift to someone else")
)

// Kinds and how long a plan gift lasts.
var Months = map[string]int{"pro1": 1, "vip3": 3}

var planOf = map[string]string{"pro1": "pro", "vip3": "vip"}

type Store struct{ DB *pgxpool.Pool }

type New struct {
	Kind        string    `json:"kind"`
	ShowtimeID  string    `json:"showtimeId"`
	AmountCents int       `json:"amountCents"`
	Currency    string    `json:"currency"`
	Name        string    `json:"name"`
	To          string    `json:"to"` // email or phone
	Message     string    `json:"message"`
	DeliverAt   time.Time `json:"deliverAt"`
	HoldID      string    `json:"holdId"`
	OrderID     string    `json:"orderId"`
}

type Gift struct {
	ID          string     `json:"id"`
	Code        string     `json:"code,omitempty"`
	Kind        string     `json:"kind"`
	ShowtimeID  string     `json:"showtimeId,omitempty"`
	AmountCents int        `json:"amountCents"`
	Currency    string     `json:"currency"`
	Name        string     `json:"name"`
	Email       string     `json:"email,omitempty"`
	Phone       string     `json:"phone,omitempty"`
	Message     string     `json:"message"`
	DeliverAt   time.Time  `json:"deliverAt"`
	DeliveredAt *time.Time `json:"deliveredAt,omitempty"`
	Status      string     `json:"status"`
	RedeemedAt  *time.Time `json:"redeemedAt,omitempty"`
	GiverName   string     `json:"giverName,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
}

const cols = `g.id, g.code, g.kind, coalesce(g.showtime_id, ''), g.amount_cents, g.currency, g.recipient_name, coalesce(g.recipient_email, ''),
  coalesce(g.recipient_phone, ''), g.message, g.deliver_at, g.delivered_at, g.status, g.redeemed_at, a.name, g.created_at`

func scan(r pgx.Row) (Gift, error) {
	var g Gift
	err := r.Scan(&g.ID, &g.Code, &g.Kind, &g.ShowtimeID, &g.AmountCents, &g.Currency, &g.Name, &g.Email, &g.Phone, &g.Message,
		&g.DeliverAt, &g.DeliveredAt, &g.Status, &g.RedeemedAt, &g.GiverName, &g.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return g, ErrNotFound
	}
	return g, err
}

// newCode makes a redeem code like ECG-7K3M-Q9TX (no 0/O or 1/I to misread).
func newCode() (string, error) {
	const abc = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	for i := range b {
		b[i] = abc[int(b[i])%len(abc)]
	}
	return "ECG-" + string(b[:4]) + "-" + string(b[4:]), nil
}

func normPhone(p string) (string, bool) {
	var b strings.Builder
	for i, r := range strings.TrimSpace(p) {
		switch {
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '+' && i == 0:
			b.WriteRune(r)
		case r == ' ' || r == '-' || r == '(' || r == ')':
		default:
			return "", false
		}
	}
	s := b.String()
	return s, strings.HasPrefix(s, "+") && len(s) >= 9 && len(s) <= 16
}

// Create records a gift while the giver approves the PayPal order. The order id ties it to the payment.
func (st Store) Create(ctx context.Context, giverID string, n New) (Gift, error) {
	n.Name, n.Message = strings.TrimSpace(n.Name), strings.TrimSpace(n.Message)
	if n.Name == "" || len(n.Name) > 80 || len(n.Message) > 500 || n.OrderID == "" || n.AmountCents <= 0 || n.Currency == "" {
		return Gift{}, fmt.Errorf("%w: add their name, and keep the message under 500 characters", ErrBadInput)
	}
	if n.Kind != "seat" && n.Kind != "credit" && Months[n.Kind] == 0 {
		return Gift{}, fmt.Errorf("%w: unknown gift", ErrBadInput)
	}
	if (n.Kind == "seat") != (n.ShowtimeID != "") || (n.Kind == "seat") != (n.HoldID != "") {
		return Gift{}, fmt.Errorf("%w: a seat gift needs a premiere", ErrBadInput)
	}
	var email, phone *string
	if a, err := mail.ParseAddress(strings.TrimSpace(n.To)); err == nil && strings.Contains(n.To, "@") {
		e := strings.ToLower(a.Address)
		email = &e
	} else if p, ok := normPhone(n.To); ok {
		phone = &p
	} else {
		return Gift{}, fmt.Errorf("%w: enter their email, or a WhatsApp number starting with +", ErrBadInput)
	}
	if n.DeliverAt.IsZero() || n.DeliverAt.Before(time.Now()) {
		n.DeliverAt = time.Now()
	}
	if n.DeliverAt.After(time.Now().AddDate(1, 0, 0)) {
		return Gift{}, fmt.Errorf("%w: delivery can be up to a year ahead", ErrBadInput)
	}
	code, err := newCode()
	if err != nil {
		return Gift{}, err
	}
	var show, hold *string
	if n.Kind == "seat" {
		show, hold = &n.ShowtimeID, &n.HoldID
	}
	var id string
	err = st.DB.QueryRow(ctx, `INSERT INTO gifts (code, giver_id, kind, showtime_id, hold_id, amount_cents, currency, recipient_name, recipient_email, recipient_phone, message, deliver_at, paypal_order_id)
	  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
		code, giverID, n.Kind, show, hold, n.AmountCents, n.Currency, n.Name, email, phone, n.Message, n.DeliverAt, n.OrderID).Scan(&id)
	if err != nil {
		return Gift{}, err
	}
	return st.get(ctx, `g.id = $1`, id)
}

func (st Store) get(ctx context.Context, where string, arg any) (Gift, error) {
	return scan(st.DB.QueryRow(ctx, `SELECT `+cols+` FROM gifts g JOIN accounts a ON a.id = g.giver_id WHERE `+where, arg))
}

// ByCode is what the redeem page shows. The code is the secret, so it is never listed elsewhere.
func (st Store) ByCode(ctx context.Context, code string) (Gift, error) {
	return st.get(ctx, `g.code = $1`, strings.ToUpper(strings.TrimSpace(code)))
}

// Sent lists the gifts an account bought, newest first (the "Gifted" tab in My tickets).
func (st Store) Sent(ctx context.Context, giverID string) ([]Gift, error) {
	rows, err := st.DB.Query(ctx, `SELECT `+cols+` FROM gifts g JOIN accounts a ON a.id = g.giver_id
	  WHERE g.giver_id = $1 AND g.status <> 'pending' ORDER BY g.created_at DESC LIMIT 100`, giverID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Gift, error) { return scan(r) })
}

// MarkPaid confirms a gift's PayPal capture. It reports whether the order was a gift.
func (st Store) MarkPaid(ctx context.Context, orderID, captureID string) (bool, error) {
	tag, err := st.DB.Exec(ctx, `UPDATE gifts SET status = 'paid', paypal_capture_id = $2
	  WHERE paypal_order_id = $1 AND (status = 'pending' OR paypal_capture_id = $2)`, orderID, captureID)
	return err == nil && tag.RowsAffected() > 0, err
}

// Due hands back paid gifts whose delivery time has come, once each, for the emails.
// DueGift is a gift to hand out, with the giver's email for when the recipient has only a phone number.
type DueGift struct {
	Gift
	GiverEmail string `json:"giverEmail"`
}

func (st Store) Due(ctx context.Context) ([]DueGift, error) {
	rows, err := st.DB.Query(ctx, `WITH due AS (
	    UPDATE gifts SET delivered_at = now() WHERE id IN (
	      SELECT id FROM gifts WHERE status = 'paid' AND delivered_at IS NULL AND deliver_at <= now() ORDER BY deliver_at LIMIT 200 FOR UPDATE SKIP LOCKED)
	    RETURNING *)
	  SELECT `+cols+`, coalesce(a.email, '') FROM due g JOIN accounts a ON a.id = g.giver_id`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (DueGift, error) {
		var d DueGift
		g := &d.Gift
		err := r.Scan(&g.ID, &g.Code, &g.Kind, &g.ShowtimeID, &g.AmountCents, &g.Currency, &g.Name, &g.Email, &g.Phone, &g.Message,
			&g.DeliverAt, &g.DeliveredAt, &g.Status, &g.RedeemedAt, &g.GiverName, &g.CreatedAt, &d.GiverEmail)
		return d, err
	})
}

// EndGiftPlans drops accounts whose gifted plan ran out back to Free.
func (st Store) EndGiftPlans(ctx context.Context) (int64, error) {
	tag, err := st.DB.Exec(ctx, `UPDATE accounts SET plan = 'free', plan_status = 'active', plan_gift_until = NULL, plan_renews_at = NULL
	  WHERE plan_gift_until < now() AND paypal_subscription_id IS NULL`)
	return tag.RowsAffected(), err
}

// Redeemed says what the recipient got.
type Redeemed struct {
	Kind        string `json:"kind"`
	ShowtimeID  string `json:"showtimeId,omitempty"`
	Plan        string `json:"plan,omitempty"`
	Until       string `json:"until,omitempty"`
	CreditCents int    `json:"creditCents,omitempty"` // set for credit, or a plan given to someone who already pays
}

// Redeem gives the gift to the signed-in account.
func (st Store) Redeem(ctx context.Context, code, accountID string) (Redeemed, error) {
	var out Redeemed
	err := pgx.BeginFunc(ctx, st.DB, func(tx pgx.Tx) error {
		var id, giver, kind, status, currency string
		var show, hold *string
		var cents int
		err := tx.QueryRow(ctx, `SELECT id, giver_id, kind, showtime_id, hold_id, amount_cents, currency, status FROM gifts WHERE code = $1 FOR UPDATE`,
			strings.ToUpper(strings.TrimSpace(code))).Scan(&id, &giver, &kind, &show, &hold, &cents, &currency, &status)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		switch {
		case status == "pending":
			return ErrNotPaid
		case status == "redeemed":
			return ErrRedeemed
		case giver == accountID:
			return ErrOwnGift
		}
		out.Kind = kind
		switch kind {
		case "seat":
			var has bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM holds WHERE showtime_id = $1 AND account_id = $2 AND status = 'paid')`, *show, accountID).Scan(&has); err != nil {
				return err
			}
			if has {
				return ErrSeatInUse
			}
			if _, err := tx.Exec(ctx, `UPDATE holds SET account_id = $2 WHERE id = $1`, *hold, accountID); err != nil {
				return err
			}
			out.ShowtimeID = *show
		case "credit":
			if _, err := tx.Exec(ctx, `INSERT INTO credits (account_id, delta_cents, currency, reason, ref) VALUES ($1, $2, $3, 'gift', 'gift:' || $4)`, accountID, cents, currency, id); err != nil {
				return err
			}
			out.CreditCents = cents
		default:
			var sub *string
			if err := tx.QueryRow(ctx, `SELECT paypal_subscription_id FROM accounts WHERE id = $1 FOR UPDATE`, accountID).Scan(&sub); err != nil {
				return err
			}
			if sub != nil {
				// They already pay for a plan: the gift becomes credit rather than clashing with it.
				if _, err := tx.Exec(ctx, `INSERT INTO credits (account_id, delta_cents, currency, reason, ref) VALUES ($1, $2, $3, 'gift', 'gift:' || $4)`, accountID, cents, currency, id); err != nil {
					return err
				}
				out.CreditCents = cents
				break
			}
			var until time.Time
			if err := tx.QueryRow(ctx, `UPDATE accounts SET plan = $2, plan_status = 'active', pending_plan = NULL,
			    plan_gift_until = GREATEST(coalesce(plan_gift_until, now()), now()) + make_interval(months => $3), plan_renews_at = NULL
			  WHERE id = $1 RETURNING plan_gift_until`, accountID, planOf[kind], Months[kind]).Scan(&until); err != nil {
				return err
			}
			out.Plan, out.Until = planOf[kind], until.Format(time.RFC3339)
		}
		_, err = tx.Exec(ctx, `UPDATE gifts SET status = 'redeemed', redeemed_by = $2, redeemed_at = now() WHERE id = $1`, id, accountID)
		return err
	})
	return out, err
}

// Balance is the account's credit in cents.
func (st Store) Balance(ctx context.Context, accountID string) (int, error) {
	var c int
	err := st.DB.QueryRow(ctx, `SELECT coalesce(sum(delta_cents), 0) FROM credits WHERE account_id = $1`, accountID).Scan(&c)
	return c, err
}

// PayWithCredit pays a held seat from credit; netCents is the price before VAT (the studio's share is worked out from it).
// PayWithCredit pays a held seat from credit. All or nothing: credit never splits with PayPal.
func (st Store) PayWithCredit(ctx context.Context, accountID, holdID string, cents, netCents int) error {
	if cents <= 0 || netCents < 0 || netCents > cents {
		return fmt.Errorf("%w: bad amount", ErrBadInput)
	}
	return pgx.BeginFunc(ctx, st.DB, func(tx pgx.Tx) error {
		// Serialise spending per account so two tabs cannot spend the same credit.
		if _, err := tx.Exec(ctx, `SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE`, accountID); err != nil {
			return err
		}
		var bal int
		if err := tx.QueryRow(ctx, `SELECT coalesce(sum(delta_cents), 0) FROM credits WHERE account_id = $1`, accountID).Scan(&bal); err != nil {
			return err
		}
		if bal < cents {
			return ErrNoCredit
		}
		tag, err := tx.Exec(ctx, `UPDATE holds SET status = 'paid', paypal_capture_id = 'CREDIT-' || id, net_cents = $3
		  WHERE id = $1 AND account_id = $2 AND status = 'held' AND expires_at > now()`, holdID, accountID, netCents)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrHoldGone
		}
		_, err = tx.Exec(ctx, `INSERT INTO credits (account_id, delta_cents, reason, ref) VALUES ($1, $2, 'seat', 'hold:' || $3)`, accountID, -cents, holdID)
		return err
	})
}

// RefundCredit gives back the credit spent on a seat and frees the seat. The caller checks the seat
// is the viewer's and still cancellable. Repeats change nothing (the refund row has a unique ref).
func (st Store) RefundCredit(ctx context.Context, accountID, holdID string) (int, error) {
	var cents int
	err := pgx.BeginFunc(ctx, st.DB, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `SELECT -delta_cents FROM credits WHERE account_id = $1 AND ref = 'hold:' || $2`, accountID, holdID).Scan(&cents)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrHoldGone
		}
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE holds SET status = 'refunded', paypal_refund_id = 'CREDIT-REFUND-' || id, refunded_at = now()
		  WHERE id = $1 AND account_id = $2 AND status = 'paid' AND paypal_capture_id = 'CREDIT-' || id`, holdID, accountID); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO credits (account_id, delta_cents, reason, ref) VALUES ($1, $2, 'refund', 'refund:' || $3) ON CONFLICT (ref) DO NOTHING`, accountID, cents, holdID)
		return err
	})
	return cents, err
}
