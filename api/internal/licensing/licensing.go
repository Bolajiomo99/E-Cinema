// Package licensing runs the licensed merch programme (Figma 114:1933 and the Licensee frames
// 116:38 to 116:726): applications and licence fees, the partner's team, product approvals,
// sales by channel, place and film, QR label batches, royalty statements and compliance.
//
// Money is kept in naira, the programme's own currency.
package licensing

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound  = errors.New("not found")
	ErrBadInput  = errors.New("invalid request")
	ErrForbidden = errors.New("only the licence owner can do that")
	ErrState     = errors.New("that cannot be changed now")
	ErrLimit     = errors.New("your plan's limit is reached")
)

type Plan struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	FeeNGN       int    `json:"feeNgn"` // a year; 0 means agreed with sales
	RoyaltyPct   int    `json:"royaltyPct"`
	MaxCountries int    `json:"maxCountries"` // 0 means any
	MaxProducts  int    `json:"maxProducts"`  // 0 means unlimited
	InShop       bool   `json:"inShop"`
}

var Plans = map[string]Plan{
	"starter": {"starter", "Starter", 250000, 8, 1, 5, false},
	"growth":  {"growth", "Growth", 1200000, 6, 3, 30, true},
	"global":  {"global", "Global", 0, 5, 0, 0, true},
}

type Store struct{ DB *pgxpool.Pool }

func clip(s string, n int) string {
	s = strings.TrimSpace(s)
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}

var (
	ccRe     = regexp.MustCompile(`^[A-Z]{2}$`)
	keyRe    = regexp.MustCompile(`^licensing/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$`)
	emailRe  = regexp.MustCompile(`^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$`)
	digitsRe = regexp.MustCompile(`^[0-9]{6,20}$`)
)

func countries(list []string, plan Plan) ([]string, error) {
	out := []string{}
	seen := map[string]bool{}
	for _, c := range list {
		c = strings.ToUpper(strings.TrimSpace(c))
		if !ccRe.MatchString(c) || seen[c] {
			continue
		}
		seen[c] = true
		out = append(out, c)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("%w: choose at least one country", ErrBadInput)
	}
	if plan.MaxCountries > 0 && len(out) > plan.MaxCountries {
		return nil, fmt.Errorf("%w: the %s plan covers %d %s", ErrBadInput, plan.Name, plan.MaxCountries, map[bool]string{true: "country", false: "countries"}[plan.MaxCountries == 1])
	}
	return out, nil
}

// ---- Applications (Figma 116:38) ----

type Application struct {
	ID         string     `json:"id"`
	Plan       string     `json:"plan"`
	Company    string     `json:"company"`
	RegNumber  string     `json:"regNumber"`
	Country    string     `json:"country"`
	City       string     `json:"city"`
	Website    string     `json:"website"`
	Countries  []string   `json:"countries"`
	Products   string     `json:"products"`
	DocKey     string     `json:"docKey"`
	DocNote    string     `json:"docNote"`
	DocOK      bool       `json:"docOk"`
	Photos     []string   `json:"photos"`
	Status     string     `json:"status"`
	ReviewNote string     `json:"reviewNote"`
	FeeNGN     int        `json:"feeNgn"`
	PaidAt     *time.Time `json:"paidAt,omitempty"`
	Licence    *string    `json:"licence,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
	// For the brand team.
	Applicant string `json:"applicant,omitempty"`
	Account   string `json:"-"`
}

const appCols = `id, plan, company, reg_number, country, city, website, countries, products, doc_key, doc_note, doc_ok, photos, status, review_note, fee_ngn, paid_at, licence, created_at, account_id`

func scanApp(r pgx.Row, extra ...any) (Application, error) {
	var a Application
	err := r.Scan(append([]any{&a.ID, &a.Plan, &a.Company, &a.RegNumber, &a.Country, &a.City, &a.Website, &a.Countries, &a.Products, &a.DocKey, &a.DocNote, &a.DocOK, &a.Photos, &a.Status, &a.ReviewNote, &a.FeeNGN, &a.PaidAt, &a.Licence, &a.CreatedAt, &a.Account}, extra...)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return a, ErrNotFound
	}
	return a, err
}

// App is the account's application, or ErrNotFound.
func (st Store) App(ctx context.Context, accountID string) (Application, error) {
	return scanApp(st.DB.QueryRow(ctx, `SELECT `+appCols+` FROM licence_applications WHERE account_id = $1`, accountID))
}

type Draft struct {
	Plan      string   `json:"plan"`
	Company   string   `json:"company"`
	RegNumber string   `json:"regNumber"`
	Country   string   `json:"country"`
	City      string   `json:"city"`
	Website   string   `json:"website"`
	Countries []string `json:"countries"`
	Products  string   `json:"products"`
}

// Save keeps the application's details while it is a draft (or after a rejection, to fix it).
func (st Store) Save(ctx context.Context, accountID string, d Draft) (Application, error) {
	plan, ok := Plans[d.Plan]
	if !ok {
		return Application{}, fmt.Errorf("%w: choose a plan", ErrBadInput)
	}
	d.Country = strings.ToUpper(strings.TrimSpace(d.Country))
	if !ccRe.MatchString(d.Country) {
		return Application{}, fmt.Errorf("%w: choose your company's country", ErrBadInput)
	}
	cs := d.Countries
	if len(cs) == 0 {
		cs = []string{d.Country}
	}
	list, err := countries(cs, plan)
	if err != nil {
		return Application{}, err
	}
	a, err := scanApp(st.DB.QueryRow(ctx, `INSERT INTO licence_applications (account_id, plan, company, reg_number, country, city, website, countries, products)
	  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	  ON CONFLICT (account_id) DO UPDATE SET plan = $2, company = $3, reg_number = $4, country = $5, city = $6, website = $7, countries = $8, products = $9,
	    status = 'draft', updated_at = now()
	  WHERE licence_applications.status IN ('draft', 'rejected')
	  RETURNING `+appCols, accountID, plan.ID, clip(d.Company, 120), clip(d.RegNumber, 40), d.Country, clip(d.City, 80), clip(strings.ToLower(d.Website), 120), list, clip(d.Products, 500)))
	if errors.Is(err, ErrNotFound) {
		return a, ErrState
	}
	return a, err
}

// SetDoc stores the company certificate and what the AI check read from it.
func (st Store) SetDoc(ctx context.Context, accountID, key, note string, ok bool) (Application, error) {
	if !keyRe.MatchString(key) {
		return Application{}, fmt.Errorf("%w: document", ErrBadInput)
	}
	return st.patchDraft(ctx, accountID, `doc_key = $2, doc_note = $3, doc_ok = $4`, key, clip(note, 300), ok)
}

// SetPhotos stores the factory or workshop photos.
func (st Store) SetPhotos(ctx context.Context, accountID string, keys []string) (Application, error) {
	if len(keys) > 8 {
		return Application{}, fmt.Errorf("%w: up to 8 photos", ErrBadInput)
	}
	for _, k := range keys {
		if !keyRe.MatchString(k) || strings.HasSuffix(k, ".pdf") {
			return Application{}, fmt.Errorf("%w: photo", ErrBadInput)
		}
	}
	if keys == nil {
		keys = []string{}
	}
	return st.patchDraft(ctx, accountID, `photos = $2`, keys)
}

func (st Store) patchDraft(ctx context.Context, accountID, set string, args ...any) (Application, error) {
	a, err := scanApp(st.DB.QueryRow(ctx, `UPDATE licence_applications SET `+set+`, updated_at = now() WHERE account_id = $1 AND status IN ('draft', 'rejected') RETURNING `+appCols,
		append([]any{accountID}, args...)...))
	if errors.Is(err, ErrNotFound) {
		if _, e := st.App(ctx, accountID); e == nil {
			return a, ErrState
		}
	}
	return a, err
}

// Submit sends the application to the brand team. The director must have passed the face and ID check.
func (st Store) Submit(ctx context.Context, accountID string, identityOK bool) (Application, error) {
	a, err := st.App(ctx, accountID)
	if err != nil {
		return a, err
	}
	switch {
	case a.Status != "draft" && a.Status != "rejected":
		return a, ErrState
	case a.Company == "" || a.RegNumber == "":
		return a, fmt.Errorf("%w: add your company name and registration number", ErrBadInput)
	case a.DocKey == "":
		return a, fmt.Errorf("%w: upload your certificate of incorporation", ErrBadInput)
	case len(a.Photos) == 0:
		return a, fmt.Errorf("%w: add at least one photo of your factory or workshop", ErrBadInput)
	case !identityOK:
		return a, fmt.Errorf("%w: the director's face and ID check is needed first", ErrBadInput)
	}
	return scanApp(st.DB.QueryRow(ctx, `UPDATE licence_applications SET status = 'submitted', review_note = '', updated_at = now() WHERE id = $1 RETURNING `+appCols, a.ID))
}

// Queue lists applications waiting for the brand team.
func (st Store) Queue(ctx context.Context) ([]Application, error) {
	rows, err := st.DB.Query(ctx, `SELECT `+prefixed("l", appCols)+`, ac.name || ' · ' || ac.email FROM licence_applications l JOIN accounts ac ON ac.id = l.account_id
	  WHERE l.status IN ('submitted', 'approved') OR l.updated_at > now() - interval '14 days' ORDER BY l.status = 'submitted' DESC, l.updated_at`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Application, error) {
		var who string
		a, err := scanApp(r, &who)
		a.Applicant = who
		return a, err
	})
}

func prefixed(t, cols string) string {
	parts := strings.Split(cols, ", ")
	for i, p := range parts {
		parts[i] = t + "." + p
	}
	return strings.Join(parts, ", ")
}

// Review approves (setting the licence fee) or sends back an application.
func (st Store) Review(ctx context.Context, id string, approve bool, note string, feeNGN int) (Application, error) {
	a, err := scanApp(st.DB.QueryRow(ctx, `SELECT `+appCols+` FROM licence_applications WHERE id = $1`, id))
	if err != nil {
		return a, err
	}
	if a.Status != "submitted" {
		return a, ErrState
	}
	if !approve {
		if clip(note, 300) == "" {
			return a, fmt.Errorf("%w: say what needs fixing", ErrBadInput)
		}
		return scanApp(st.DB.QueryRow(ctx, `UPDATE licence_applications SET status = 'rejected', review_note = $2, updated_at = now() WHERE id = $1 RETURNING `+appCols, id, clip(note, 300)))
	}
	if f := Plans[a.Plan].FeeNGN; f > 0 {
		feeNGN = f
	}
	if feeNGN < 100000 {
		return a, fmt.Errorf("%w: set the agreed yearly fee", ErrBadInput)
	}
	return scanApp(st.DB.QueryRow(ctx, `UPDATE licence_applications SET status = 'approved', review_note = $2, fee_ngn = $3, updated_at = now() WHERE id = $1 RETURNING `+appCols, id, clip(note, 300), feeNGN))
}

// AttachPayment links a PayPal order for the licence fee to an approved application.
func (st Store) AttachPayment(ctx context.Context, accountID, orderID string) error {
	tag, err := st.DB.Exec(ctx, `UPDATE licence_applications SET paypal_order_id = $2, updated_at = now() WHERE account_id = $1 AND status = 'approved'`, accountID, orderID)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrState
	}
	return err
}

// MarkPaid activates the licence once its fee is captured: a licence number, a year's validity,
// and the applicant as owner. It returns nil when the order is not a licence fee.
func (st Store) MarkPaid(ctx context.Context, orderID string) (*Application, error) {
	var out *Application
	err := pgx.BeginFunc(ctx, st.DB, func(tx pgx.Tx) error {
		a, err := scanApp(tx.QueryRow(ctx, `SELECT `+appCols+` FROM licence_applications WHERE paypal_order_id = $1 FOR UPDATE`, orderID))
		if errors.Is(err, ErrNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		if a.Status == "active" {
			out = &a
			return nil
		}
		var n int
		if err := tx.QueryRow(ctx, `SELECT nextval('licence_number')`).Scan(&n); err != nil {
			return err
		}
		licence := fmt.Sprintf("%s-%04d", a.Country, n)
		if _, err := tx.Exec(ctx, `INSERT INTO brand_licensees (licence, name, city, country, website, account_id, plan, countries, valid_from, valid_until)
		  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, current_date, current_date + 365)`,
			licence, a.Company, a.City, a.Country, strings.TrimPrefix(strings.TrimPrefix(a.Website, "https://"), "www."), a.Account, a.Plan, a.Countries); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO licence_members (licence, email, account_id, role) SELECT $1, email, id, 'owner' FROM accounts WHERE id = $2`, licence, a.Account); err != nil {
			return err
		}
		a, err = scanApp(tx.QueryRow(ctx, `UPDATE licence_applications SET status = 'active', paid_at = now(), licence = $2, updated_at = now() WHERE id = $1 RETURNING `+appCols, a.ID, licence))
		out = &a
		return err
	})
	return out, err
}

// ---- The partner and their team ----

type Licensee struct {
	Licence        string     `json:"licence"`
	Name           string     `json:"name"`
	City           string     `json:"city"`
	Country        string     `json:"country"`
	Website        string     `json:"website"`
	Status         string     `json:"status"`
	Plan           Plan       `json:"plan"`
	Countries      []string   `json:"countries"`
	ValidFrom      time.Time  `json:"validFrom"`
	ValidUntil     time.Time  `json:"validUntil"`
	PayoutBank     string     `json:"payoutBank"`
	PayoutLast4    string     `json:"payoutLast4"`
	PayoutName     string     `json:"payoutName"`
	PayoutVerified bool       `json:"payoutVerified"`
	PayoutHold     *time.Time `json:"payoutHoldUntil,omitempty"`
	Role           string     `json:"role"`
}

// For returns the licence the account belongs to, or ErrNotFound.
func (st Store) For(ctx context.Context, accountID string) (Licensee, error) {
	var l Licensee
	var plan, number string
	err := st.DB.QueryRow(ctx, `SELECT b.licence, b.name, b.city, b.country, b.website, b.status, b.plan, b.countries, b.valid_from, b.valid_until,
	    b.payout_bank, b.payout_number, b.payout_name, b.payout_verified, b.payout_hold_until, m.role
	  FROM licence_members m JOIN brand_licensees b USING (licence) WHERE m.account_id = $1 ORDER BY m.role = 'owner' DESC LIMIT 1`, accountID).
		Scan(&l.Licence, &l.Name, &l.City, &l.Country, &l.Website, &l.Status, &plan, &l.Countries, &l.ValidFrom, &l.ValidUntil,
			&l.PayoutBank, &number, &l.PayoutName, &l.PayoutVerified, &l.PayoutHold, &l.Role)
	if errors.Is(err, pgx.ErrNoRows) {
		return l, ErrNotFound
	}
	l.Plan = Plans[plan]
	if len(number) >= 4 {
		l.PayoutLast4 = number[len(number)-4:]
	}
	return l, err
}

// Claim links invitations sent to this email address to the account, on sign-in.
func (st Store) Claim(ctx context.Context, accountID, email string) error {
	_, err := st.DB.Exec(ctx, `UPDATE licence_members SET account_id = $1 WHERE lower(email) = lower($2) AND account_id IS NULL`, accountID, email)
	return err
}

type Member struct {
	Email   string    `json:"email"`
	Name    string    `json:"name"`
	Role    string    `json:"role"`
	Joined  bool      `json:"joined"`
	AddedAt time.Time `json:"addedAt"`
}

func (st Store) Members(ctx context.Context, licence string) ([]Member, error) {
	rows, err := st.DB.Query(ctx, `SELECT m.email, coalesce(a.name, ''), m.role, m.account_id IS NOT NULL, m.added_at FROM licence_members m
	  LEFT JOIN accounts a ON a.id = m.account_id WHERE m.licence = $1 ORDER BY m.role = 'owner' DESC, m.added_at`, licence)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Member, error) {
		var m Member
		return m, r.Scan(&m.Email, &m.Name, &m.Role, &m.Joined, &m.AddedAt)
	})
}

// AddMember invites someone by email; they join when they sign in with it. Owners only.
func (st Store) AddMember(ctx context.Context, l Licensee, email string) error {
	if l.Role != "owner" {
		return ErrForbidden
	}
	email = strings.ToLower(strings.TrimSpace(email))
	if !emailRe.MatchString(email) {
		return fmt.Errorf("%w: enter an email address", ErrBadInput)
	}
	var n int
	if err := st.DB.QueryRow(ctx, `SELECT count(*) FROM licence_members WHERE licence = $1`, l.Licence).Scan(&n); err != nil {
		return err
	}
	if n >= 25 {
		return ErrLimit
	}
	_, err := st.DB.Exec(ctx, `INSERT INTO licence_members (licence, email, account_id) VALUES ($1, $2, (SELECT id FROM accounts WHERE lower(email) = $2))
	  ON CONFLICT DO NOTHING`, l.Licence, email)
	return err
}

func (st Store) RemoveMember(ctx context.Context, l Licensee, email string) error {
	if l.Role != "owner" {
		return ErrForbidden
	}
	tag, err := st.DB.Exec(ctx, `DELETE FROM licence_members WHERE licence = $1 AND lower(email) = lower($2) AND role <> 'owner'`, l.Licence, email)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

// Settings changes the public details partners can edit themselves.
func (st Store) Settings(ctx context.Context, l Licensee, city, website string) error {
	if l.Role != "owner" {
		return ErrForbidden
	}
	website = strings.TrimPrefix(strings.TrimPrefix(strings.ToLower(strings.TrimSpace(website)), "https://"), "http://")
	website = strings.TrimPrefix(strings.TrimSuffix(website, "/"), "www.")
	if website != "" && (!strings.Contains(website, ".") || strings.ContainsAny(website, " /")) {
		return fmt.Errorf("%w: the website should look like yourshop.com", ErrBadInput)
	}
	_, err := st.DB.Exec(ctx, `UPDATE brand_licensees SET city = $2, website = $3 WHERE licence = $1`, l.Licence, clip(city, 80), clip(website, 120))
	return err
}

// SetPayout changes where E-Cinema pays the partner. A change holds payouts for 48 hours.
func (st Store) SetPayout(ctx context.Context, l Licensee, bank, number, name string, identityOK bool) error {
	if l.Role != "owner" {
		return ErrForbidden
	}
	if !identityOK {
		return fmt.Errorf("%w: the director's face and ID check is needed first", ErrBadInput)
	}
	number = strings.ReplaceAll(strings.TrimSpace(number), " ", "")
	if clip(bank, 60) == "" || !digitsRe.MatchString(number) || clip(name, 120) == "" {
		return fmt.Errorf("%w: add the bank, account number and account name", ErrBadInput)
	}
	_, err := st.DB.Exec(ctx, `UPDATE brand_licensees SET payout_bank = $2, payout_number = $3, payout_name = $4,
	    payout_verified = lower($4) = lower(name), payout_hold_until = now() + interval '48 hours' WHERE licence = $1`, l.Licence, clip(bank, 60), number, clip(name, 120))
	return err
}

// ---- QR label batches ----

const codeAlphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ" // no 0/O, 1/I/L

func randomCode() (string, error) {
	b := make([]byte, 8)
	for i := range b {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(codeAlphabet))))
		if err != nil {
			return "", err
		}
		b[i] = codeAlphabet[n.Int64()]
	}
	return "EC-QR-" + string(b[:4]) + "-" + string(b[4:]), nil
}

// Issue makes a batch of one-time codes for an approved product.
func (st Store) Issue(ctx context.Context, l Licensee, productID string, count int) (string, []string, error) {
	if count < 1 || count > 5000 {
		return "", nil, fmt.Errorf("%w: 1 to 5,000 labels at a time", ErrBadInput)
	}
	if l.Status != "active" || time.Now().After(l.ValidUntil.Add(24*time.Hour)) {
		return "", nil, fmt.Errorf("%w: renew your licence to print labels", ErrBadInput)
	}
	var name, status string
	if err := st.DB.QueryRow(ctx, `SELECT name, status FROM licence_products WHERE id = $1 AND licence = $2`, productID, l.Licence).Scan(&name, &status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil, ErrNotFound
		}
		return "", nil, err
	}
	if status != "live" {
		return "", nil, fmt.Errorf("%w: only approved products get labels", ErrBadInput)
	}
	batch := fmt.Sprintf("%s-%s", strings.ReplaceAll(l.Licence, "-", ""), time.Now().UTC().Format("20060102-150405"))
	codes := make([]string, 0, count)
	err := pgx.BeginFunc(ctx, st.DB, func(tx pgx.Tx) error {
		for len(codes) < count {
			c, err := randomCode()
			if err != nil {
				return err
			}
			tag, err := tx.Exec(ctx, `INSERT INTO brand_codes (code, licence, product, batch, product_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`, c, l.Licence, name, batch, productID)
			if err != nil {
				return err
			}
			if tag.RowsAffected() == 1 {
				codes = append(codes, c)
			}
		}
		return nil
	})
	return batch, codes, err
}

// Batch returns the codes of one batch, for printing again.
func (st Store) Batch(ctx context.Context, l Licensee, batch string) ([]string, string, error) {
	rows, err := st.DB.Query(ctx, `SELECT code, product FROM brand_codes WHERE licence = $1 AND batch = $2 ORDER BY code`, l.Licence, batch)
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()
	var codes []string
	var product string
	for rows.Next() {
		var c string
		if err := rows.Scan(&c, &product); err != nil {
			return nil, "", err
		}
		codes = append(codes, c)
	}
	if len(codes) == 0 {
		return nil, "", ErrNotFound
	}
	return codes, product, rows.Err()
}
