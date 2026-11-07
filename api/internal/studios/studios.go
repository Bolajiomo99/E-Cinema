// Package studios runs the studio portal (Figma "06 Studio Portal"): a studio's onboarding,
// its team, and the real numbers behind its overview, films and payouts. Studios keep 70%
// of net ticket revenue; payouts themselves are made by the tickets package after each screening.
package studios

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound    = errors.New("no studio for this account")
	ErrForbidden   = errors.New("your role on this studio cannot do that")
	ErrLocked      = errors.New("this studio is under review or verified; contact us to change its details")
	ErrIncomplete  = errors.New("finish every step first")
	ErrBadInput    = errors.New("check the highlighted fields")
	ErrNameTaken   = errors.New("a studio with that name already exists")
	ErrLastOwner   = errors.New("a studio needs at least one owner")
	ErrNotVerified = errors.New("this studio is not verified yet")
	ErrTaken       = errors.New("that person already belongs to another studio")
	ErrFull        = errors.New("a studio team can have up to 50 people")
)

// MaxMembers caps a studio team.
const MaxMembers = 50

type Store struct{ DB *pgxpool.Pool }

var Roles = []string{"owner", "admin", "finance", "marketing", "viewer"}

// What each role may do. Owners do everything; viewers only look.
func can(role, action string) bool {
	switch action {
	case "edit":
		return role == "owner" || role == "admin"
	case "team":
		return role == "owner" || role == "admin"
	case "money":
		return role == "owner" || role == "admin" || role == "finance"
	case "marketing":
		return role == "owner" || role == "admin" || role == "marketing"
	}
	return true
}

type Studio struct {
	Name           string     `json:"name"`
	Slug           string     `json:"slug"`
	LegalName      string     `json:"legalName"`
	RegCountry     string     `json:"regCountry"`
	RegNumber      string     `json:"regNumber"`
	City           string     `json:"city"`
	Website        string     `json:"website"`
	Status         string     `json:"status"`
	ReviewNote     string     `json:"reviewNote"`
	DocsKey        string     `json:"docsKey"`
	DocsOK         bool       `json:"docsOk"`
	PayoutMethod   string     `json:"payoutMethod"`
	PayoutEmail    string     `json:"payoutEmail"`
	PayoutBank     string     `json:"payoutBank"`
	PayoutBankCode string     `json:"payoutBankCode"`
	PayoutNumber   string     `json:"payoutNumber"`
	PayoutName     string     `json:"payoutName"`
	PayoutCurrency string     `json:"payoutCurrency"`
	ShareBps       int        `json:"shareBps"`
	RightsNote     string     `json:"rightsNote"`
	RightsAt       *time.Time `json:"rightsAt"`
	TermsAt        *time.Time `json:"termsAt"`
	VerifiedAt     *time.Time `json:"verifiedAt"`
	CreatedAt      time.Time  `json:"createdAt"`
	DubReview      bool       `json:"dubReview"`        // new dubbed languages wait for a person's approval
	Blocked        []string   `json:"blockedCountries"` // countries where none of its films are sold
	Bio            string     `json:"bio"`              // the studio's own words on its public page
	Role           string     `json:"role,omitempty"`
	Owner          string     `json:"owner,omitempty"`
}

// Steps reports the four onboarding steps of Figma 34:49.
func (s Studio) Steps() map[string]bool {
	payout := (s.PayoutMethod == "paypal" && s.PayoutEmail != "" && !strings.HasPrefix(s.PayoutEmail, "payouts+")) ||
		(s.PayoutMethod == "bank" && s.PayoutBank != "" && s.PayoutNumber != "" && s.PayoutName != "")
	return map[string]bool{"docs": s.DocsKey != "", "payout": payout, "rights": s.RightsAt != nil, "terms": s.TermsAt != nil}
}

const cols = `st.name, coalesce(st.slug, ''), st.legal_name, st.reg_country, st.reg_number, st.city, st.website, st.status, st.review_note,
  st.docs_key, st.docs_ok, st.payout_method, st.payout_email, st.payout_bank, st.payout_bank_code, st.payout_number, st.payout_name, st.payout_currency, st.share_bps,
  st.rights_note, st.rights_at, st.terms_at, st.verified_at, st.created_at, st.dub_review, st.blocked_countries, st.bio`

func scan(r pgx.Row, extra ...any) (Studio, error) {
	var s Studio
	err := r.Scan(append([]any{&s.Name, &s.Slug, &s.LegalName, &s.RegCountry, &s.RegNumber, &s.City, &s.Website, &s.Status, &s.ReviewNote,
		&s.DocsKey, &s.DocsOK, &s.PayoutMethod, &s.PayoutEmail, &s.PayoutBank, &s.PayoutBankCode, &s.PayoutNumber, &s.PayoutName, &s.PayoutCurrency, &s.ShareBps,
		&s.RightsNote, &s.RightsAt, &s.TermsAt, &s.VerifiedAt, &s.CreatedAt, &s.DubReview, &s.Blocked, &s.Bio}, extra...)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return s, ErrNotFound
	}
	return s, err
}

// Mine is the studio this account belongs to. An invite sent to the account's email is
// claimed here, the first time its owner signs in.
func (st Store) Mine(ctx context.Context, acct, email string) (Studio, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if _, err := st.DB.Exec(ctx, `UPDATE studio_members SET account_id = $1 WHERE email = $2 AND account_id IS NULL`, acct, email); err != nil {
		return Studio{}, err
	}
	var role string
	s, err := scan(st.DB.QueryRow(ctx, `SELECT `+cols+`, m.role FROM studio_members m JOIN studios st ON st.name = m.studio
	  WHERE m.account_id = $1 ORDER BY m.added_at LIMIT 1`, acct), &role)
	s.Role = role
	return s, err
}

func (st Store) mine(ctx context.Context, acct, email string) (Studio, error) {
	return st.Mine(ctx, acct, email)
}

func clip(s string, n int) string {
	s = strings.TrimSpace(s)
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}

var slugRe = regexp.MustCompile(`[^a-z0-9]+`)

func slugOf(name string) string {
	return strings.Trim(slugRe.ReplaceAllString(strings.ToLower(name), "-"), "-")
}

type Draft struct {
	Name, LegalName, RegCountry, RegNumber, City, Website string
}

// Save starts a studio (the caller becomes its owner) or edits one still in draft.
func (st Store) Save(ctx context.Context, acct, email string, d Draft) (Studio, error) {
	d.Name, d.LegalName, d.RegNumber, d.City, d.Website = clip(d.Name, 80), clip(d.LegalName, 120), clip(d.RegNumber, 40), clip(d.City, 60), clip(d.Website, 200)
	d.RegCountry = strings.ToUpper(clip(d.RegCountry, 2))
	if len([]rune(d.Name)) < 2 || len(d.RegCountry) != 2 || slugOf(d.Name) == "" {
		return Studio{}, ErrBadInput
	}
	if d.LegalName == "" {
		d.LegalName = d.Name
	}
	cur, err := st.mine(ctx, acct, email)
	if errors.Is(err, ErrNotFound) {
		tx, err := st.DB.Begin(ctx)
		if err != nil {
			return Studio{}, err
		}
		defer tx.Rollback(ctx)
		tag, err := tx.Exec(ctx, `INSERT INTO studios (name, payout_email, slug, legal_name, reg_country, reg_number, city, website, status, verified_at)
		  VALUES ($1, '', $2, $3, $4, $5, $6, $7, 'draft', NULL) ON CONFLICT DO NOTHING`, d.Name, slugOf(d.Name), d.LegalName, d.RegCountry, d.RegNumber, d.City, d.Website)
		if err != nil || tag.RowsAffected() == 0 {
			return Studio{}, errors.Join(ErrNameTaken, err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO studio_members (studio, email, account_id, role) VALUES ($1, $2, $3, 'owner')`, d.Name, strings.ToLower(email), acct); err != nil {
			return Studio{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return Studio{}, err
		}
		return st.mine(ctx, acct, email)
	}
	if err != nil {
		return Studio{}, err
	}
	if !can(cur.Role, "edit") {
		return Studio{}, ErrForbidden
	}
	if cur.Status == "submitted" || cur.Status == "verified" {
		// A verified studio can still fix its city and website.
		_, err := st.DB.Exec(ctx, `UPDATE studios SET city = $2, website = $3 WHERE name = $1`, cur.Name, d.City, d.Website)
		if err != nil {
			return Studio{}, err
		}
		return st.mine(ctx, acct, email)
	}
	tag, err := st.DB.Exec(ctx, `UPDATE studios SET name = $2, slug = $3, legal_name = $4, reg_country = $5, reg_number = $6, city = $7, website = $8
	  WHERE name = $1 AND NOT EXISTS (SELECT 1 FROM studios o WHERE o.name <> $1 AND (o.name = $2 OR o.slug = $3))`,
		cur.Name, d.Name, slugOf(d.Name), d.LegalName, d.RegCountry, d.RegNumber, d.City, d.Website)
	if err != nil {
		return Studio{}, err
	}
	if tag.RowsAffected() == 0 {
		return Studio{}, ErrNameTaken
	}
	return st.mine(ctx, acct, email)
}

// editable runs fn on the caller's studio if their role allows the action and the studio
// is not locked for review.
func (st Store) editable(ctx context.Context, acct, email, action string, lockVerified bool, fn func(s Studio) error) (Studio, error) {
	s, err := st.mine(ctx, acct, email)
	if err != nil {
		return s, err
	}
	if !can(s.Role, action) {
		return s, ErrForbidden
	}
	if s.Status == "submitted" || (lockVerified && s.Status == "verified") {
		return s, ErrLocked
	}
	if err := fn(s); err != nil {
		return s, err
	}
	return st.mine(ctx, acct, email)
}

func (st Store) SetDocs(ctx context.Context, acct, email, key string, ok bool) (Studio, error) {
	if !strings.HasPrefix(key, "studios/") || len(key) > 200 {
		return Studio{}, ErrBadInput
	}
	return st.editable(ctx, acct, email, "edit", true, func(s Studio) error {
		_, err := st.DB.Exec(ctx, `UPDATE studios SET docs_key = $2, docs_ok = $3 WHERE name = $1`, s.Name, key, ok)
		return err
	})
}

type Payout struct {
	Method, Email, Bank, Number, Name, Currency string
	// BankCode is the bank's code on the transfer network (Flutterwave's bank list), so the
	// payout can be sent by bank transfer without anyone typing it in by hand.
	BankCode string
}

var (
	accountNo = regexp.MustCompile(`^[0-9A-Z ]{6,34}$`)
	bankCode  = regexp.MustCompile(`^[0-9A-Z]{2,10}$`)
)

// SetPayout records where the studio's share goes. Changing it on a verified studio is
// allowed (finance teams change banks) and takes effect from the next payout.
func (st Store) SetPayout(ctx context.Context, acct, email string, p Payout) (Studio, error) {
	p.Method, p.Currency = strings.ToLower(p.Method), strings.ToUpper(clip(p.Currency, 3))
	p.Email, p.Bank, p.Name = strings.ToLower(clip(p.Email, 120)), clip(p.Bank, 80), clip(p.Name, 120)
	p.Number = strings.ToUpper(clip(p.Number, 34))
	p.BankCode = strings.ToUpper(strings.TrimSpace(clip(p.BankCode, 10)))
	if p.Currency == "" {
		p.Currency = "USD"
	}
	switch p.Method {
	case "paypal":
		if a, err := mail.ParseAddress(p.Email); err != nil || a.Address != p.Email {
			return Studio{}, ErrBadInput
		}
		p.Bank, p.Number, p.Name, p.BankCode = "", "", "", ""
	case "bank":
		if p.Bank == "" || p.Name == "" || !accountNo.MatchString(p.Number) || !bankCode.MatchString(p.BankCode) {
			return Studio{}, ErrBadInput
		}
	default:
		return Studio{}, ErrBadInput
	}
	return st.editable(ctx, acct, email, "money", false, func(s Studio) error {
		_, err := st.DB.Exec(ctx, `UPDATE studios SET payout_method = $2, payout_email = CASE WHEN $2 = 'paypal' THEN $3 ELSE payout_email END,
		  payout_bank = $4, payout_number = $5, payout_name = $6, payout_currency = $7, payout_bank_code = $8 WHERE name = $1`, s.Name, p.Method, p.Email, p.Bank, p.Number, p.Name, p.Currency, p.BankCode)
		if err != nil {
			return err
		}
		// New details: refused payouts get a fresh round of attempts, by the new method.
		_, err = st.DB.Exec(ctx, `UPDATE studio_payouts SET attempts = 0, method = $2, updated_at = now() WHERE studio = $1 AND status = 'failed'`, s.Name, p.Method)
		return err
	})
}

func (st Store) DeclareRights(ctx context.Context, acct, email, note string) (Studio, error) {
	note = clip(note, 2000)
	if len([]rune(note)) < 20 {
		return Studio{}, ErrBadInput
	}
	return st.editable(ctx, acct, email, "edit", true, func(s Studio) error {
		_, err := st.DB.Exec(ctx, `UPDATE studios SET rights_note = $2, rights_at = now() WHERE name = $1`, s.Name, note)
		return err
	})
}

func (st Store) AcceptTerms(ctx context.Context, acct, email string) (Studio, error) {
	return st.editable(ctx, acct, email, "edit", true, func(s Studio) error {
		_, err := st.DB.Exec(ctx, `UPDATE studios SET terms_at = now() WHERE name = $1`, s.Name)
		return err
	})
}

// Submit sends a finished application to the E-Cinema studio desk.
func (st Store) Submit(ctx context.Context, acct, email string) (Studio, error) {
	return st.editable(ctx, acct, email, "edit", true, func(s Studio) error {
		for _, done := range s.Steps() {
			if !done {
				return ErrIncomplete
			}
		}
		_, err := st.DB.Exec(ctx, `UPDATE studios SET status = 'submitted', review_note = '' WHERE name = $1`, s.Name)
		return err
	})
}

// ---- The studio desk (E-Cinema staff) ----

func (st Store) Applications(ctx context.Context) ([]Studio, error) {
	rows, err := st.DB.Query(ctx, `SELECT `+cols+`, coalesce((SELECT email FROM studio_members m WHERE m.studio = st.name AND m.role = 'owner' ORDER BY added_at LIMIT 1), '')
	  FROM studios st WHERE st.status IN ('submitted', 'draft', 'rejected') ORDER BY st.status = 'submitted' DESC, st.created_at DESC LIMIT 200`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Studio{}
	for rows.Next() {
		var owner string
		s, err := scan(rows, &owner)
		if err != nil {
			return nil, err
		}
		s.Owner = owner
		out = append(out, s)
	}
	return out, rows.Err()
}

func (st Store) Review(ctx context.Context, slug string, approve bool, note string) error {
	note = clip(note, 500)
	if !approve && note == "" {
		return ErrBadInput
	}
	status := "rejected"
	if approve {
		status = "verified"
	}
	tag, err := st.DB.Exec(ctx, `UPDATE studios SET status = $2, review_note = $3, verified_at = CASE WHEN $2 = 'verified' THEN now() ELSE verified_at END
	  WHERE slug = $1 AND status = 'submitted'`, slug, status, note)
	if err == nil && tag.RowsAffected() == 0 {
		err = ErrNotFound
	}
	return err
}

// ---- Team (Figma 39:980) ----

type Member struct {
	Email   string    `json:"email"`
	Name    string    `json:"name"`
	Role    string    `json:"role"`
	Joined  bool      `json:"joined"`
	AddedAt time.Time `json:"addedAt"`
	Me      bool      `json:"me"`
}

func (st Store) Team(ctx context.Context, acct, email string) ([]Member, error) {
	s, err := st.mine(ctx, acct, email)
	if err != nil {
		return nil, err
	}
	rows, err := st.DB.Query(ctx, `SELECT m.email, coalesce(a.name, ''), m.role, m.account_id IS NOT NULL, m.added_at, m.account_id IS NOT DISTINCT FROM $2::uuid
	  FROM studio_members m LEFT JOIN accounts a ON a.id = m.account_id WHERE m.studio = $1
	  ORDER BY array_position(ARRAY['owner','admin','finance','marketing','viewer'], m.role), m.added_at`, s.Name, acct)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Member{}
	for rows.Next() {
		var m Member
		if err := rows.Scan(&m.Email, &m.Name, &m.Role, &m.Joined, &m.AddedAt, &m.Me); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func validRole(r string) bool {
	for _, x := range Roles {
		if x == r {
			return true
		}
	}
	return false
}

// SetMember invites someone by email or changes their role. Only owners can make owners.
func (st Store) SetMember(ctx context.Context, acct, email, who, role string) error {
	who = strings.ToLower(strings.TrimSpace(who))
	if a, err := mail.ParseAddress(who); err != nil || a.Address != who || !validRole(role) {
		return ErrBadInput
	}
	s, err := st.mine(ctx, acct, email)
	if err != nil {
		return err
	}
	if !can(s.Role, "team") || (role == "owner" && s.Role != "owner") {
		return ErrForbidden
	}
	return st.withOwnerCheck(ctx, s.Name, func(tx pgx.Tx) error {
		var cur string
		var elsewhere bool
		var n int
		if err := tx.QueryRow(ctx, `SELECT coalesce((SELECT role FROM studio_members WHERE studio = $1 AND email = $2), ''),
		  EXISTS (SELECT 1 FROM studio_members WHERE studio <> $1 AND email = $2),
		  (SELECT count(*) FROM studio_members WHERE studio = $1)`, s.Name, who).Scan(&cur, &elsewhere, &n); err != nil {
			return err
		}
		switch {
		case cur == "owner" && s.Role != "owner":
			return ErrForbidden // only an owner changes another owner
		case elsewhere:
			return ErrTaken // one studio per person
		case cur == "" && n >= MaxMembers:
			return ErrFull
		}
		_, err := tx.Exec(ctx, `INSERT INTO studio_members (studio, email, account_id, role)
		  VALUES ($1, $2, (SELECT id FROM accounts WHERE lower(email) = $2), $3)
		  ON CONFLICT (studio, email) DO UPDATE SET role = EXCLUDED.role`, s.Name, who, role)
		return err
	})
}

func (st Store) RemoveMember(ctx context.Context, acct, email, who string) error {
	who = strings.ToLower(strings.TrimSpace(who))
	s, err := st.mine(ctx, acct, email)
	if err != nil {
		return err
	}
	if !can(s.Role, "team") {
		return ErrForbidden
	}
	return st.withOwnerCheck(ctx, s.Name, func(tx pgx.Tx) error {
		var role string
		if err := tx.QueryRow(ctx, `DELETE FROM studio_members WHERE studio = $1 AND email = $2 RETURNING role`, s.Name, who).Scan(&role); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if role == "owner" && s.Role != "owner" {
			return ErrForbidden
		}
		return nil
	})
}

// withOwnerCheck runs a team change and refuses it if it would leave the studio with no owner.
func (st Store) withOwnerCheck(ctx context.Context, studio string, fn func(pgx.Tx) error) error {
	tx, err := st.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT 1 FROM studios WHERE name = $1 FOR UPDATE`, studio); err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		return err
	}
	var owners int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM studio_members WHERE studio = $1 AND role = 'owner'`, studio).Scan(&owners); err != nil {
		return err
	}
	if owners == 0 {
		return ErrLastOwner
	}
	return tx.Commit(ctx)
}

// ---- Numbers (Figma 34:274 overview, 34:458 films, 39:349 revenue) ----

// net is what a paid hold brought in, before the split.
const netExpr = `coalesce(h.net_cents, h.seats * s.price_cents)`

type Film struct {
	ShowtimeID  string    `json:"showtimeId"`
	Film        string    `json:"film"`
	StartsAt    time.Time `json:"startsAt"`
	DurationMin int       `json:"durationMin"`
	Capacity    int       `json:"capacity"`
	Seats       int       `json:"seats"`
	GrossCents  int64     `json:"grossCents"`
	ShareCents  int64     `json:"shareCents"`
	Currency    string    `json:"currency"`
	Rating      float64   `json:"rating"`
	Reviews     int       `json:"reviews"`
	Countries   int       `json:"countries"`
	Completion  float64   `json:"completion"`
	State       string    `json:"state"` // upcoming, live, ended
	Payout      string    `json:"payout"`
	// Origin is the first screening this one repeats (itself for a premiere); encores share it.
	Origin   string `json:"origin"`
	UploadID string `json:"uploadId,omitempty"`
}

func (st Store) Films(ctx context.Context, acct, email string) ([]Film, error) {
	s, err := st.mine(ctx, acct, email)
	if err != nil {
		return nil, err
	}
	return st.films(ctx, s.Name, s.ShareBps)
}

func (st Store) films(ctx context.Context, studio string, share int) ([]Film, error) {
	rows, err := st.DB.Query(ctx, `SELECT s.id, s.film, s.starts_at, s.duration_min, s.capacity, s.currency,
	  coalesce(sum(h.seats) FILTER (WHERE h.status = 'paid'), 0),
	  coalesce(sum(`+netExpr+`) FILTER (WHERE h.status = 'paid'), 0),
	  count(DISTINCT a.country) FILTER (WHERE h.status = 'paid' AND a.country IS NOT NULL),
	  coalesce((SELECT avg(r.stars) FROM reviews r WHERE r.showtime_id = s.id AND NOT r.hidden), 0),
	  (SELECT count(*) FROM reviews r WHERE r.showtime_id = s.id AND NOT r.hidden),
	  coalesce((SELECT avg(least(1.0, w.secs / (s.duration_min * 60.0))) FROM (SELECT sum(seconds) secs FROM watch_beats b WHERE b.showtime_id = s.id GROUP BY b.account_id) w), 0),
	  coalesce((SELECT status FROM studio_payouts p WHERE p.showtime_id = s.id), ''),
	  CASE WHEN now() < s.starts_at THEN 'upcoming' WHEN now() < s.starts_at + s.duration_min * interval '1 minute' THEN 'live' ELSE 'ended' END,
	  o.origin, coalesce((SELECT p.upload::text FROM studio_premieres p WHERE p.showtime_id = o.origin), '')
	  FROM showtimes s
	  CROSS JOIN LATERAL (SELECT coalesce(s.encore_of, (SELECT e.origin FROM studio_encores e WHERE e.showtime_id = s.id), s.id) AS origin) o
	  LEFT JOIN holds h ON h.showtime_id = s.id LEFT JOIN accounts a ON a.id = h.account_id
	  WHERE s.studio = $1 GROUP BY s.id, o.origin ORDER BY s.starts_at DESC`, studio)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Film{}
	for rows.Next() {
		var f Film
		if err := rows.Scan(&f.ShowtimeID, &f.Film, &f.StartsAt, &f.DurationMin, &f.Capacity, &f.Currency, &f.Seats, &f.GrossCents, &f.Countries,
			&f.Rating, &f.Reviews, &f.Completion, &f.Payout, &f.State, &f.Origin, &f.UploadID); err != nil {
			return nil, err
		}
		f.ShareCents = f.GrossCents * int64(share) / 10000
		out = append(out, f)
	}
	return out, rows.Err()
}

type Month struct {
	Month      string `json:"month"` // 2026-10
	GrossCents int64  `json:"grossCents"`
}

type Overview struct {
	Studio        Studio  `json:"studio"`
	Currency      string  `json:"currency"`
	EarnedMonth   int64   `json:"earnedMonth"`
	EarnedLast    int64   `json:"earnedLast"`
	SeatsMonth    int     `json:"seatsMonth"`
	SeatsLast     int     `json:"seatsLast"`
	Countries     int     `json:"countries"`
	NewCountries  int     `json:"newCountries"`
	Completion    float64 `json:"completion"`
	Rating        float64 `json:"rating"`
	Reviews       int     `json:"reviews"`
	Months        []Month `json:"months"`
	Coming        []Film  `json:"coming"`
	Live          *Film   `json:"live"`
	OwedCents     int64   `json:"owedCents"`
	PaidCents     int64   `json:"paidCents"`
	PlatformCents int64   `json:"platformCents"`
	TopCountries  []Count `json:"topCountries"`
	Notes         []Note  `json:"notes"`
}

type Count struct {
	Key   string `json:"key"`
	Seats int    `json:"seats"`
}

// Note is one line of "Studio AI noticed", worked out from the studio's own numbers.
type Note struct {
	Kind string `json:"kind"`
	Text string `json:"text"`
}

func monthStart(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC)
}

func (st Store) Overview(ctx context.Context, acct, email string, now time.Time) (Overview, error) {
	s, err := st.mine(ctx, acct, email)
	if err != nil {
		return Overview{}, err
	}
	o := Overview{Studio: s, Currency: "USD", Months: []Month{}, Coming: []Film{}, TopCountries: []Count{}, Notes: []Note{}}
	this := monthStart(now.UTC())
	last := this.AddDate(0, -1, 0)
	year := this.AddDate(0, -11, 0)
	share := int64(s.ShareBps)

	var grossMonth, grossLast int64
	err = st.DB.QueryRow(ctx, `SELECT
	  coalesce(sum(`+netExpr+`) FILTER (WHERE h.created_at >= $2), 0), coalesce(sum(`+netExpr+`) FILTER (WHERE h.created_at >= $3 AND h.created_at < $2), 0),
	  coalesce(sum(h.seats) FILTER (WHERE h.created_at >= $2), 0), coalesce(sum(h.seats) FILTER (WHERE h.created_at >= $3 AND h.created_at < $2), 0),
	  count(DISTINCT a.country), count(DISTINCT a.country) FILTER (WHERE NOT EXISTS (
	    SELECT 1 FROM holds h2 JOIN showtimes s2 ON s2.id = h2.showtime_id JOIN accounts a2 ON a2.id = h2.account_id
	    WHERE s2.studio = $1 AND h2.status = 'paid' AND h2.created_at < $2 AND a2.country = a.country))
	  FROM holds h JOIN showtimes s ON s.id = h.showtime_id LEFT JOIN accounts a ON a.id = h.account_id
	  WHERE s.studio = $1 AND h.status = 'paid'`, s.Name, this, last).Scan(&grossMonth, &grossLast, &o.SeatsMonth, &o.SeatsLast, &o.Countries, &o.NewCountries)
	if err != nil {
		return o, fmt.Errorf("overview totals: %w", err)
	}
	o.EarnedMonth, o.EarnedLast = grossMonth*share/10000, grossLast*share/10000

	if err := st.DB.QueryRow(ctx, `SELECT coalesce(avg(r.stars), 0), count(*) FROM reviews r JOIN showtimes s ON s.id = r.showtime_id WHERE s.studio = $1 AND NOT r.hidden`, s.Name).Scan(&o.Rating, &o.Reviews); err != nil {
		return o, err
	}
	if err := st.DB.QueryRow(ctx, `SELECT coalesce(avg(least(1.0, w.secs / (w.dur * 60.0))), 0) FROM (
	  SELECT sum(b.seconds) secs, max(s.duration_min) dur FROM watch_beats b JOIN showtimes s ON s.id = b.showtime_id WHERE s.studio = $1 GROUP BY b.account_id, b.showtime_id) w`, s.Name).Scan(&o.Completion); err != nil {
		return o, err
	}

	rows, err := st.DB.Query(ctx, `SELECT to_char(m, 'YYYY-MM'), coalesce((SELECT sum(`+netExpr+`) FROM holds h JOIN showtimes s ON s.id = h.showtime_id
	  WHERE s.studio = $1 AND h.status = 'paid' AND h.created_at >= m AND h.created_at < m + interval '1 month'), 0)
	  FROM generate_series($2::timestamptz, $3::timestamptz, interval '1 month') m ORDER BY m`, s.Name, year, this)
	if err != nil {
		return o, err
	}
	for rows.Next() {
		var m Month
		if err := rows.Scan(&m.Month, &m.GrossCents); err != nil {
			rows.Close()
			return o, err
		}
		o.Months = append(o.Months, m)
	}
	rows.Close()

	rows, err = st.DB.Query(ctx, `SELECT a.country, sum(h.seats) FROM holds h JOIN showtimes s ON s.id = h.showtime_id JOIN accounts a ON a.id = h.account_id
	  WHERE s.studio = $1 AND h.status = 'paid' AND a.country IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 5`, s.Name)
	if err != nil {
		return o, err
	}
	for rows.Next() {
		var c Count
		if err := rows.Scan(&c.Key, &c.Seats); err != nil {
			rows.Close()
			return o, err
		}
		o.TopCountries = append(o.TopCountries, c)
	}
	rows.Close()

	films, err := st.films(ctx, s.Name, s.ShareBps)
	if err != nil {
		return o, err
	}
	for i := len(films) - 1; i >= 0; i-- {
		f := films[i]
		switch f.State {
		case "upcoming":
			if len(o.Coming) < 3 {
				o.Coming = append(o.Coming, f)
			}
		case "live":
			f := f
			o.Live = &f
		}
	}

	if err := st.DB.QueryRow(ctx, `SELECT
	  coalesce(sum(p.studio_cents) FILTER (WHERE p.status = 'sent'), 0),
	  coalesce(sum(p.gross_cents - p.studio_cents) FILTER (WHERE p.status = 'sent'), 0)
	  FROM studio_payouts p WHERE p.studio = $1`, s.Name).Scan(&o.PaidCents, &o.PlatformCents); err != nil {
		return o, err
	}
	for _, f := range films {
		if f.State == "ended" && f.Payout != "sent" && f.Payout != "nothing_due" {
			o.OwedCents += f.ShareCents
		}
	}
	o.Notes = notes(o, films, now)
	return o, nil
}

// notes picks out what a studio would want to act on, from its own numbers only.
func notes(o Overview, films []Film, now time.Time) []Note {
	out := []Note{}
	for _, f := range films {
		if f.State != "upcoming" || f.Capacity == 0 {
			continue
		}
		pct := float64(f.Seats) / float64(f.Capacity)
		days := f.StartsAt.Sub(now).Hours() / 24
		switch {
		case pct >= 0.9:
			out = append(out, Note{"seats", fmt.Sprintf("%s is %.0f%% sold. Consider adding an encore screening.", f.Film, pct*100)})
		case days < 3 && pct < 0.25:
			out = append(out, Note{"seats", fmt.Sprintf("%s starts in under 3 days with %.0f%% of seats sold. A watch-party push or clip could help.", f.Film, pct*100)})
		}
	}
	if len(o.TopCountries) > 0 && o.SeatsMonth+o.SeatsLast > 0 {
		total := 0
		for _, c := range o.TopCountries {
			total += c.Seats
		}
		top := o.TopCountries[0]
		if total > 0 && len(o.TopCountries) > 1 {
			out = append(out, Note{"audience", fmt.Sprintf("%s buys the most seats for your films (%d of the top %d countries' %d).", top.Key, top.Seats, len(o.TopCountries), total)})
		}
	}
	for _, f := range films {
		if f.State == "ended" && f.Reviews >= 5 && f.Rating >= 4.5 {
			out = append(out, Note{"rating", fmt.Sprintf("%s is rated %.1f from %d reviews. Good material for marketing clips.", f.Film, f.Rating, f.Reviews)})
			break
		}
	}
	if o.Studio.Steps()["payout"] == false {
		out = append(out, Note{"payout", "Add a payout account so your 70% share can be sent after each screening."})
	}
	if len(out) > 4 {
		out = out[:4]
	}
	return out
}

// ---- Payouts (Figma 39:349) ----

type PayoutRow struct {
	ShowtimeID  string    `json:"showtimeId"`
	Film        string    `json:"film"`
	StartsAt    time.Time `json:"startsAt"`
	Seats       int       `json:"seats"`
	GrossCents  int64     `json:"grossCents"`
	StudioCents int64     `json:"studioCents"`
	Currency    string    `json:"currency"`
	Status      string    `json:"status"`
	BatchID     string    `json:"batchId"`
	UpdatedAt   time.Time `json:"updatedAt"`
	// Bank transfers: how it was sent, the transfer id and what landed in the account.
	Method       string `json:"method"`
	TransferID   string `json:"transferId"`
	PaidCurrency string `json:"paidCurrency"`
	PaidMinor    int64  `json:"paidMinor"`
}

func (st Store) Payouts(ctx context.Context, acct, email string) (Studio, []PayoutRow, error) {
	s, err := st.mine(ctx, acct, email)
	if err != nil {
		return s, nil, err
	}
	if !can(s.Role, "money") {
		return s, nil, ErrForbidden
	}
	out, err := st.payoutsOf(ctx, s.Name)
	return s, out, err
}

func (st Store) payoutsOf(ctx context.Context, studio string) ([]PayoutRow, error) {
	rows, err := st.DB.Query(ctx, `SELECT p.showtime_id, s.film, s.starts_at, p.paid_seats, p.gross_cents, p.studio_cents, p.currency, p.status, coalesce(p.paypal_batch_id, ''), p.updated_at,
	    p.method, p.transfer_id, p.paid_currency, p.paid_minor
	  FROM studio_payouts p JOIN showtimes s ON s.id = p.showtime_id WHERE p.studio = $1 ORDER BY s.starts_at DESC LIMIT 200`, studio)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PayoutRow{}
	for rows.Next() {
		var p PayoutRow
		if err := rows.Scan(&p.ShowtimeID, &p.Film, &p.StartsAt, &p.Seats, &p.GrossCents, &p.StudioCents, &p.Currency, &p.Status, &p.BatchID, &p.UpdatedAt, &p.Method, &p.TransferID, &p.PaidCurrency, &p.PaidMinor); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
