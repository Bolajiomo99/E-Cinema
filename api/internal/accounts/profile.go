package accounts

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
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
		coalesce(app_language, ''), coalesce(audio_language, ''), coalesce(contact_phone, ''), plan, plan_status
		FROM accounts WHERE id = $1`, accountID).
		Scan(&p.Country, &p.BirthDate, &p.Gender, &p.AppLanguage, &p.AudioLanguage, &p.ContactPhone, &p.Plan, &p.PlanStatus)
	return p, err
}

// ChoosePlan records the plan picked at sign-up. Free is active at once; paid plans wait for payment.
func (s Store) ChoosePlan(ctx context.Context, accountID, plan string) (Profile, error) {
	if !Plans[plan] {
		return Profile{}, fmt.Errorf("%w: unknown plan", ErrBadInput)
	}
	status := "awaiting_payment"
	if plan == "free" {
		status = "active"
	}
	if _, err := s.DB.Exec(ctx, `UPDATE accounts SET plan = $2, plan_status = $3 WHERE id = $1`, accountID, plan, status); err != nil {
		return Profile{}, err
	}
	return s.GetProfile(ctx, accountID)
}
