package tickets

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// Adult titles unlock after four payments (Figma 28:839). Stages 1 to 3 go to the charity,
// church and mosque funds; stage 4, the access fee, is the seat itself (a normal hold).
var (
	Funds          = [3]string{"charity", "church", "mosque"}
	ErrStagesDue   = errors.New("pay the earlier unlock stages first")
	ErrWrongStage  = errors.New("that is not the next unlock stage")
	ErrNotAdultFlm = errors.New("this title has no adult unlock")
	ErrRecipient   = errors.New("pick a recipient from the list for this payment")
)

// RecipientKind is who each fund stage pays: a charity, a church pastor, or a mosque cleric.
var RecipientKind = [3]string{"charity", "pastor", "cleric"}

type Recipient struct {
	ID      string `json:"id"`
	Kind    string `json:"kind"`
	Name    string `json:"name"`
	City    string `json:"city"`
	Country string `json:"country"`
}

// Recipients lists the active recipients viewers can pick for one stage.
func (st Store) Recipients(ctx context.Context, stage int) ([]Recipient, error) {
	if stage < 1 || stage > 3 {
		return nil, ErrWrongStage
	}
	rows, err := st.DB.Query(ctx, `SELECT id::text, kind, name, city, country FROM adult_recipients WHERE kind = $1 AND status = 'active' ORDER BY name`, RecipientKind[stage-1])
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Recipient, error) {
		var x Recipient
		return x, r.Scan(&x.ID, &x.Kind, &x.Name, &x.City, &x.Country)
	})
}

type Stage struct {
	Stage       int        `json:"stage"`
	Fund        string     `json:"fund"`
	AmountCents int        `json:"amountCents"`
	Currency    string     `json:"currency"`
	Status      string     `json:"status"`
	PaidAt      *time.Time `json:"paidAt,omitempty"`
}

// Stages lists the paid and pending unlock stages for one adult title.
func (st Store) Stages(ctx context.Context, accountID, showtimeID string) ([]Stage, error) {
	rows, err := st.DB.Query(ctx, `SELECT stage, fund, amount_cents, currency, status, paid_at FROM adult_stages
	  WHERE account_id = $1 AND showtime_id = $2 ORDER BY stage`, accountID, showtimeID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Stage, error) {
		var s Stage
		return s, r.Scan(&s.Stage, &s.Fund, &s.AmountCents, &s.Currency, &s.Status, &s.PaidAt)
	})
}

func paidStages(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, accountID, showtimeID string) (int, error) {
	var n int
	err := q.QueryRow(ctx, `SELECT count(*) FROM adult_stages WHERE account_id = $1 AND showtime_id = $2 AND status = 'paid'`, accountID, showtimeID).Scan(&n)
	return n, err
}

// AttachStage records the PayPal order for the next unpaid stage. A newer order replaces an
// unpaid one for the same stage (the viewer closed PayPal and tried again).
// recipient is the viewer's pick; it must be active and of the stage's kind. It may be empty only
// while no recipient of that kind is active (the payment then goes to the general fund).
func (st Store) AttachStage(ctx context.Context, accountID, showtimeID string, stage int, orderID string, cents int, currency, recipient string) error {
	if stage < 1 || stage > 3 || cents <= 0 || orderID == "" {
		return ErrWrongStage
	}
	return pgx.BeginFunc(ctx, st.DB, func(tx pgx.Tx) error {
		var adult, ended bool
		err := tx.QueryRow(ctx, `SELECT adult, starts_at + make_interval(mins => duration_min) <= now() FROM showtimes WHERE id = $1`, showtimeID).Scan(&adult, &ended)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if !adult {
			return ErrNotAdultFlm
		}
		if ended {
			return ErrEnded
		}
		paid, err := paidStages(ctx, tx, accountID, showtimeID)
		if err != nil {
			return err
		}
		if stage != paid+1 {
			return ErrWrongStage
		}
		var ok, any bool
		if err := tx.QueryRow(ctx, `SELECT coalesce(bool_or(id::text = $2), false), count(*) > 0 FROM adult_recipients WHERE kind = $1 AND status = 'active'`,
			RecipientKind[stage-1], recipient).Scan(&ok, &any); err != nil {
			return err
		}
		if (recipient != "" && !ok) || (recipient == "" && any) {
			return ErrRecipient
		}
		_, err = tx.Exec(ctx, `INSERT INTO adult_stages (account_id, showtime_id, stage, fund, amount_cents, currency, paypal_order_id, recipient_id)
		  VALUES ($1, $2, $3, $4, $5, $6, $7, nullif($8, '')::uuid)
		  ON CONFLICT (account_id, showtime_id, stage) DO UPDATE SET paypal_order_id = EXCLUDED.paypal_order_id,
		    amount_cents = EXCLUDED.amount_cents, currency = EXCLUDED.currency, recipient_id = EXCLUDED.recipient_id, created_at = now()
		  WHERE adult_stages.status = 'pending'`,
			accountID, showtimeID, stage, Funds[stage-1], cents, currency, orderID, recipient)
		return err
	})
}

// markStagePaid confirms a stage payment by its PayPal order. Safe to repeat.
func (st Store) markStagePaid(ctx context.Context, orderID, captureID string) (bool, error) {
	tag, err := st.DB.Exec(ctx, `UPDATE adult_stages SET status = 'paid', paypal_capture_id = $2, paid_at = coalesce(paid_at, now())
	  WHERE paypal_order_id = $1 AND (status = 'pending' OR paypal_capture_id = $2)`, orderID, captureID)
	return err == nil && tag.RowsAffected() > 0, err
}
