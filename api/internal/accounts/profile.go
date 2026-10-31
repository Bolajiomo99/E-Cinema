package accounts

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// Profile is what the sign-up form asks for beyond name, email and password.
type Profile struct {
	Country       string `json:"country,omitempty"`
	BirthDate     string `json:"birthDate,omitempty"` // YYYY-MM-DD
	Gender        string `json:"gender,omitempty"`
	AppLanguage   string `json:"appLanguage,omitempty"`
	AudioLanguage string `json:"audioLanguage,omitempty"`
	ContactPhone  string `json:"contactPhone,omitempty"`
	Plan          string `json:"plan"`
	PlanStatus    string `json:"planStatus"`
	PendingPlan   string `json:"pendingPlan,omitempty"`
	RenewsAt      string `json:"renewsAt,omitempty"`
	Subscribed    bool   `json:"subscribed"`
}

// MinAge is the youngest a viewer may be to hold their own account.
const MinAge = 13

var (
	countryRe = regexp.MustCompile(`^[A-Z]{2}$`)
	langRe    = regexp.MustCompile(`^[a-z]{2,3}(-[A-Za-z]{2,4})?$`)
	genders   = map[string]bool{"": true, "female": true, "male": true, "non-binary": true, "prefer-not-to-say": true}
	Plans     = map[string]bool{"free": true, "student": true, "pro": true, "vip": true, "enterprise": true}
)

// SaveProfile stores the sign-up details. Empty fields leave what is saved untouched.
func (s Store) SaveProfile(ctx context.Context, accountID string, p Profile, now time.Time) (Profile, error) {
	p.Country = strings.ToUpper(strings.TrimSpace(p.Country))
	if p.Country != "" && !countryRe.MatchString(p.Country) {
		return Profile{}, fmt.Errorf("%w: country must be a two-letter code", ErrBadInput)
	}
	if p.BirthDate != "" {
		d, err := time.Parse("2006-01-02", p.BirthDate)
		if err != nil || d.After(now) || d.Before(now.AddDate(-120, 0, 0)) {
			return Profile{}, fmt.Errorf("%w: enter a real date of birth", ErrBadInput)
		}
		if d.After(now.AddDate(-MinAge, 0, 0)) {
			return Profile{}, fmt.Errorf("%w: you need to be at least %d to have your own account; a parent can add you as a family profile", ErrBadInput, MinAge)
		}
	}
	if !genders[p.Gender] {
		return Profile{}, fmt.Errorf("%w: unknown gender option", ErrBadInput)
	}
	for _, l := range []string{p.AppLanguage, p.AudioLanguage} {
		if l != "" && !langRe.MatchString(l) {
			return Profile{}, fmt.Errorf("%w: unknown language", ErrBadInput)
		}
	}
	if p.ContactPhone != "" {
		n, ok := NormalizePhone(p.ContactPhone)
		if !ok {
			return Profile{}, fmt.Errorf("%w: enter your mobile number with its country code", ErrBadInput)
		}
		p.ContactPhone = n
	}
	if utf8.RuneCountInString(p.Gender) > 20 {
		return Profile{}, ErrBadInput
	}
	_, err := s.DB.Exec(ctx, `UPDATE accounts SET
		country = coalesce(nullif($2, ''), country),
		birth_date = coalesce(nullif($3, '')::date, birth_date),
		gender = coalesce(nullif($4, ''), gender),
		app_language = coalesce(nullif($5, ''), app_language),
		audio_language = coalesce(nullif($6, ''), audio_language),
		contact_phone = coalesce(nullif($7, ''), contact_phone)
		WHERE id = $1`, accountID, p.Country, p.BirthDate, p.Gender, p.AppLanguage, p.AudioLanguage, p.ContactPhone)
	if err != nil {
		return Profile{}, err
	}
	return s.GetProfile(ctx, accountID)
}

func (s Store) GetProfile(ctx context.Context, accountID string) (Profile, error) {
	var p Profile
	err := s.DB.QueryRow(ctx, `SELECT coalesce(country, ''), coalesce(to_char(birth_date, 'YYYY-MM-DD'), ''), coalesce(gender, ''),
		coalesce(app_language, ''), coalesce(audio_language, ''), coalesce(contact_phone, ''), plan, plan_status,
		coalesce(pending_plan, ''), coalesce(to_char(plan_renews_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), ''), paypal_subscription_id IS NOT NULL
		FROM accounts WHERE id = $1`, accountID).
		Scan(&p.Country, &p.BirthDate, &p.Gender, &p.AppLanguage, &p.AudioLanguage, &p.ContactPhone, &p.Plan, &p.PlanStatus,
			&p.PendingPlan, &p.RenewsAt, &p.Subscribed)
	return p, err
}

// ChoosePlan records the plan picked at sign-up or on the plans page. Free is active at once.
// A paid plan waits for payment; someone already paying for a plan keeps it until the new
// subscription is approved, so changing their mind never drops them to Free.
func (s Store) ChoosePlan(ctx context.Context, accountID, plan string) (Profile, error) {
	if !Plans[plan] {
		return Profile{}, fmt.Errorf("%w: unknown plan", ErrBadInput)
	}
	var q string
	switch {
	case plan == "free":
		q = `UPDATE accounts SET plan = 'free', plan_status = 'active', pending_plan = NULL WHERE id = $1 AND $2 = 'free'`
	default:
		q = `UPDATE accounts SET
		  pending_plan = $2,
		  plan = CASE WHEN plan_status = 'active' AND plan <> 'free' THEN plan ELSE $2 END,
		  plan_status = CASE WHEN plan_status = 'active' AND plan <> 'free' THEN 'active' ELSE 'awaiting_payment' END
		  WHERE id = $1`
	}
	if _, err := s.DB.Exec(ctx, q, accountID, plan); err != nil {
		return Profile{}, err
	}
	return s.GetProfile(ctx, accountID)
}

// ActivatePlan turns an approved PayPal subscription into the account's plan. It is safe to
// call twice (the return page and the webhook both do). It returns the subscription it
// replaced, which the caller cancels at PayPal so nobody pays for two plans.
func (s Store) ActivatePlan(ctx context.Context, accountID, plan, subscriptionID string, renews time.Time) (previous string, err error) {
	if !Plans[plan] || plan == "free" || subscriptionID == "" {
		return "", fmt.Errorf("%w: bad plan or subscription", ErrBadInput)
	}
	err = pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		var old *string
		if err := tx.QueryRow(ctx, `SELECT paypal_subscription_id FROM accounts WHERE id = $1 FOR UPDATE`, accountID).Scan(&old); err != nil {
			return err
		}
		if old != nil && *old != subscriptionID {
			previous = *old
		}
		_, err := tx.Exec(ctx, `UPDATE accounts SET plan = $2, plan_status = 'active', pending_plan = NULL,
		  paypal_subscription_id = $3, plan_renews_at = $4 WHERE id = $1`, accountID, plan, subscriptionID, renews)
		return err
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return previous, err
}

// EndSubscription drops an account to Free when its subscription is cancelled or expires.
// A subscription that was already replaced by a newer one changes nothing.
func (s Store) EndSubscription(ctx context.Context, subscriptionID string) error {
	_, err := s.DB.Exec(ctx, `UPDATE accounts SET plan = 'free', plan_status = 'active', pending_plan = NULL,
		paypal_subscription_id = NULL, plan_renews_at = NULL WHERE paypal_subscription_id = $1`, subscriptionID)
	return err
}

// SubscriptionOwner says which account a subscription belongs to, for cancelling from Settings.
func (s Store) SubscriptionOf(ctx context.Context, accountID string) (string, error) {
	var sub *string
	err := s.DB.QueryRow(ctx, `SELECT paypal_subscription_id FROM accounts WHERE id = $1`, accountID).Scan(&sub)
	if err != nil || sub == nil {
		return "", err
	}
	return *sub, nil
}
