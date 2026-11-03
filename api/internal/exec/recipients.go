package exec

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// 18+ recipients (Figma 49:1577, 99:1362): the CEO's list of charities, pastors and clerics that
// 18+ unlock payments go to. Account numbers never leave this file in full.

type AdultRecipient struct {
	ID          string      `json:"id"`
	Kind        string      `json:"kind"`
	Name        string      `json:"name"`
	RegNumber   string      `json:"regNumber"`
	Country     string      `json:"country"`
	City        string      `json:"city"`
	Bank        string      `json:"bank"`
	AccountNo   string      `json:"accountNo,omitempty"` // only on the way in
	AccountLast string      `json:"accountLast"`         // last 4 digits on the way out
	AccountName string      `json:"accountName"`
	Status      string      `json:"status"`
	Note        string      `json:"note"`
	Received30  []CurAmount `json:"received30"`
}

type RecipientsPage struct {
	Recipients []AdultRecipient       `json:"recipients"`
	Paid30     map[string][]CurAmount `json:"paid30"`    // by fund: charity, church, mosque
	Unlocks30  int                    `json:"unlocks30"` // fund payments, 30 days
	Access30   []CurAmount            `json:"access30"`  // seats bought for 18+ titles, 30 days
}

func (st Store) Recipients(ctx context.Context, email string, now time.Time) (RecipientsPage, error) {
	p := RecipientsPage{Recipients: []AdultRecipient{}, Paid30: map[string][]CurAmount{}}
	if !st.ceo(email) {
		return p, ErrForbidden
	}
	from := now.AddDate(0, 0, -30)
	rows, err := st.DB.Query(ctx, `SELECT r.id::text, r.kind, r.name, r.reg_number, r.country, r.city, r.bank, right(r.account_no, 4), r.account_name, r.status, r.note,
	    coalesce((SELECT json_agg(json_build_object('currency', currency, 'minor', m)) FROM (SELECT currency, sum(amount_cents)::bigint m FROM adult_stages
	      WHERE recipient_id = r.id AND status = 'paid' AND paid_at >= $1 GROUP BY 1) x), '[]')
	  FROM adult_recipients r ORDER BY r.kind, r.status = 'active' DESC, r.name`, from)
	if err != nil {
		return p, err
	}
	if p.Recipients, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (AdultRecipient, error) {
		var x AdultRecipient
		return x, r.Scan(&x.ID, &x.Kind, &x.Name, &x.RegNumber, &x.Country, &x.City, &x.Bank, &x.AccountLast, &x.AccountName, &x.Status, &x.Note, &x.Received30)
	}); err != nil {
		return p, err
	}
	rows, err = st.DB.Query(ctx, `SELECT fund, currency, sum(amount_cents)::bigint FROM adult_stages WHERE status = 'paid' AND paid_at >= $1 GROUP BY 1, 2 ORDER BY 1, 2`, from)
	if err != nil {
		return p, err
	}
	for rows.Next() {
		var f string
		var c CurAmount
		if err := rows.Scan(&f, &c.Currency, &c.Minor); err != nil {
			rows.Close()
			return p, err
		}
		p.Paid30[f] = append(p.Paid30[f], c)
	}
	rows.Close()
	if err := st.DB.QueryRow(ctx, `SELECT count(*)::int FROM adult_stages WHERE status = 'paid' AND paid_at >= $1`, from).Scan(&p.Unlocks30); err != nil {
		return p, err
	}
	rows, err = st.DB.Query(ctx, `SELECT s.currency::text, sum(coalesce(h.net_cents, h.seats * s.price_cents))::bigint FROM holds h JOIN showtimes s ON s.id = h.showtime_id
	  WHERE s.adult AND h.status = 'paid' AND h.created_at >= $1 GROUP BY 1 ORDER BY 1`, from)
	if err != nil {
		return p, err
	}
	p.Access30, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (CurAmount, error) {
		var c CurAmount
		return c, r.Scan(&c.Currency, &c.Minor)
	})
	return p, err
}

var (
	digits    = regexp.MustCompile(`^[0-9]{6,20}$`)
	countryRe = regexp.MustCompile(`^[A-Z]{2}$`)
)

// SaveRecipient adds (no ID) or edits a recipient. A new recipient starts pending unless the bank
// confirmed the account name; the CEO switches it live. An empty account number keeps the old one.
func (st Store) SaveRecipient(ctx context.Context, email string, r AdultRecipient) (AdultRecipient, error) {
	if !st.ceo(email) {
		return r, ErrForbidden
	}
	trim := func(s *string) { *s = strings.TrimSpace(*s) }
	for _, f := range []*string{&r.Name, &r.RegNumber, &r.City, &r.Bank, &r.AccountNo, &r.AccountName, &r.Note} {
		trim(f)
	}
	r.Country = strings.ToUpper(strings.TrimSpace(r.Country))
	bad := func(msg string) (AdultRecipient, error) { return r, fmt.Errorf("%w: %s", ErrBadInput, msg) }
	switch {
	case r.Kind != "charity" && r.Kind != "pastor" && r.Kind != "cleric":
		return bad("pick charity, pastor or cleric")
	case utf8.RuneCountInString(r.Name) < 3 || utf8.RuneCountInString(r.Name) > 120:
		return bad("a name of 3 to 120 characters")
	case !countryRe.MatchString(r.Country):
		return bad("pick a country")
	case r.AccountNo != "" && !digits.MatchString(r.AccountNo):
		return bad("the account number is 6 to 20 digits")
	case utf8.RuneCountInString(r.RegNumber) > 60 || utf8.RuneCountInString(r.City) > 80 || utf8.RuneCountInString(r.Bank) > 80 || utf8.RuneCountInString(r.Note) > 300:
		return bad("one of the fields is too long")
	}
	if r.Status != "active" && r.Status != "paused" {
		r.Status = "pending"
	}
	if r.Status == "active" && (r.Bank == "" || (r.AccountNo == "" && r.ID == "")) {
		return bad("a recipient needs a bank account before payments can go to them")
	}
	var err error
	if r.ID == "" {
		err = st.DB.QueryRow(ctx, `INSERT INTO adult_recipients (kind, name, reg_number, country, city, bank, account_no, account_name, status, note, added_by)
		  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id::text, right(account_no, 4)`,
			r.Kind, r.Name, r.RegNumber, r.Country, r.City, r.Bank, r.AccountNo, r.AccountName, r.Status, r.Note, strings.ToLower(email)).Scan(&r.ID, &r.AccountLast)
	} else {
		var tag interface{ RowsAffected() int64 }
		tag, err = st.DB.Exec(ctx, `UPDATE adult_recipients SET kind = $2, name = $3, reg_number = $4, country = $5, city = $6, bank = $7,
		    account_no = CASE WHEN $8 = '' THEN account_no ELSE $8 END, account_name = CASE WHEN $8 = '' THEN account_name ELSE $9 END,
		    status = $10, note = $11, updated_at = now() WHERE id::text = $1`,
			r.ID, r.Kind, r.Name, r.RegNumber, r.Country, r.City, r.Bank, r.AccountNo, r.AccountName, r.Status, r.Note)
		if err == nil && tag.RowsAffected() == 0 {
			return r, ErrNotFound
		}
	}
	r.AccountNo = ""
	return r, err
}

// SetRecipientStatus switches a recipient on or off.
func (st Store) SetRecipientStatus(ctx context.Context, email, id, status string) error {
	if !st.ceo(email) {
		return ErrForbidden
	}
	if status != "active" && status != "paused" {
		return fmt.Errorf("%w: active or paused", ErrBadInput)
	}
	var bank, acct string
	err := st.DB.QueryRow(ctx, `SELECT bank, account_no FROM adult_recipients WHERE id::text = $1`, id).Scan(&bank, &acct)
	if err == pgx.ErrNoRows {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if status == "active" && (bank == "" || acct == "") {
		return fmt.Errorf("%w: add their bank account first", ErrBadInput)
	}
	_, err = st.DB.Exec(ctx, `UPDATE adult_recipients SET status = $2, updated_at = now() WHERE id::text = $1`, id, status)
	return err
}
