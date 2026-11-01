// Package brand protects the E-Cinema brand (Figma 114:1670, 114:1733, 114:1751, 114:1818):
// licensed merch partners print a QR authenticity code on every item, anyone can check a code,
// and members earn points and wallet credit for reporting fake sellers once an investigator
// confirms the report.
package brand

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound = errors.New("not found")
	ErrBadInput = errors.New("invalid request")
	ErrTooMany  = errors.New("you have sent a lot of reports today; try again tomorrow")
	ErrDecided  = errors.New("this report has already been decided")
)

const (
	MinReward     = 5000  // naira, for a confirmed report
	MaxReward     = 50000 // naira
	FalsePenalty  = -200  // points for a report found to be made up
	ReportsPerDay = 5
	// A genuine label is scanned by its buyer, maybe a friend, in one or two places. More than
	// this and the label has been copied onto other items.
	maxPlaces = 2
	maxScans  = 25
)

var (
	codeRe  = regexp.MustCompile(`^EC-QR-[0-9A-Z]{4}-[0-9A-Z]{4}$`)
	photoRe = regexp.MustCompile(`^reports/[0-9a-f-]{36}\.(jpg|png|webp)$`)
)

type Store struct{ DB *pgxpool.Pool }

// NormCode tidies what someone typed or scanned: case, spaces, missing dashes, or a full link.
func NormCode(s string) string {
	s = strings.ToUpper(strings.TrimSpace(s))
	if i := strings.LastIndex(s, "/"); i >= 0 {
		s = s[i+1:]
	}
	if i := strings.Index(s, "CODE="); i >= 0 {
		s = s[i+5:]
	}
	var b strings.Builder
	for _, r := range s {
		if (r >= '0' && r <= '9') || (r >= 'A' && r <= 'Z') {
			b.WriteRune(r)
		}
	}
	raw := strings.TrimPrefix(b.String(), "ECQR")
	if len(raw) != 8 {
		return s
	}
	return "EC-QR-" + raw[:4] + "-" + raw[4:]
}

type Licensee struct {
	Licence string `json:"licence"`
	Name    string `json:"name"`
	City    string `json:"city"`
	Country string `json:"country"`
	Website string `json:"website"`
	Status  string `json:"status"`
}

// Place is where a scan happened, as well as the edge network can tell.
type Place struct {
	City    string
	Country string
}

type Check struct {
	Code     string    `json:"code"`
	Genuine  bool      `json:"genuine"`
	Reason   string    `json:"reason"` // ok, never, copied, ended, bad
	First    bool      `json:"first"`  // this was the first scan ever
	Scans    int       `json:"scans"`  // including this one
	Places   int       `json:"places"`
	FirstAt  time.Time `json:"firstAt,omitzero"`
	Product  string    `json:"product,omitempty"`
	Licensee *Licensee `json:"licensee,omitempty"`
}

// Verify records a scan of code and says whether the item is genuine.
func (st Store) Verify(ctx context.Context, code string, at Place, accountID string) (Check, error) {
	code = NormCode(code)
	out := Check{Code: code}
	if !codeRe.MatchString(code) {
		out.Reason = "bad"
		return out, nil
	}
	var acct any
	if accountID != "" {
		acct = accountID
	}
	city, country := clip(at.City, 80), strings.ToUpper(clip(at.Country, 2))
	err := pgx.BeginFunc(ctx, st.DB, func(tx pgx.Tx) error {
		var l Licensee
		err := tx.QueryRow(ctx, `UPDATE brand_codes c SET scans = scans + 1, first_scan_at = coalesce(first_scan_at, now())
		    FROM brand_licensees l WHERE c.code = $1 AND l.licence = c.licence
		  RETURNING c.product, l.licence, l.name, l.city, l.country, l.website, l.status`, code).
			Scan(&out.Product, &l.Licence, &l.Name, &l.City, &l.Country, &l.Website, &l.Status)
		issued := err == nil
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO brand_scans (code, issued, city, country, account_id) VALUES ($1, $2, $3, $4, $5)`, code, issued, city, country, acct); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `SELECT count(*), count(DISTINCT coalesce(nullif(city, ''), nullif(country, ''), '?')), min(at) FROM brand_scans WHERE code = $1`, code).
			Scan(&out.Scans, &out.Places, &out.FirstAt); err != nil {
			return err
		}
		switch {
		case !issued:
			out.Reason = "never"
		case l.Status != "active":
			out.Reason, out.Licensee = "ended", &l
		case out.Places > maxPlaces || out.Scans > maxScans:
			out.Reason, out.Licensee = "copied", &l
		default:
			out.Genuine, out.Reason, out.Licensee = true, "ok", &l
			out.First = out.Scans == 1
		}
		if !out.Genuine && out.Reason != "ended" {
			out.Product = ""
		}
		return nil
	})
	return out, err
}

// Licensees are the active partners, for the public partner list and for checking reports.
func (st Store) Licensees(ctx context.Context) ([]Licensee, error) {
	rows, err := st.DB.Query(ctx, `SELECT licence, name, city, country, website, status FROM brand_licensees WHERE status = 'active' ORDER BY country = 'NG' DESC, name`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Licensee, error) {
		var l Licensee
		return l, r.Scan(&l.Licence, &l.Name, &l.City, &l.Country, &l.Website, &l.Status)
	})
}

// Host is the bare domain of a link or typed address, or "" when it is not a web address.
func Host(link string) string {
	s := strings.ToLower(strings.TrimSpace(link))
	if !strings.Contains(s, "://") {
		s = "https://" + s
	}
	u, err := url.Parse(s)
	if err != nil || !strings.Contains(u.Hostname(), ".") || strings.ContainsAny(u.Hostname(), " ,") {
		return ""
	}
	return strings.TrimPrefix(u.Hostname(), "www.")
}

// PartnerAt finds the licensed partner whose shop is at this link, if any.
func PartnerAt(list []Licensee, link string) *Licensee {
	h := Host(link)
	if h == "" {
		return nil
	}
	for i, l := range list {
		if l.Website != "" && (h == l.Website || strings.HasSuffix(h, "."+l.Website)) {
			return &list[i]
		}
	}
	return nil
}

type Report struct {
	ID        string     `json:"id"`
	Place     string     `json:"place"`
	Link      string     `json:"link"`
	Selling   string     `json:"selling"`
	Code      string     `json:"code,omitempty"`
	Photos    []string   `json:"photos"`
	AINote    string     `json:"aiNote"`
	Anonymous bool       `json:"anonymous"`
	Status    string     `json:"status"`
	Outcome   string     `json:"outcome"`
	RewardNGN int        `json:"rewardNgn"`
	Points    int        `json:"points"`
	CreatedAt time.Time  `json:"createdAt"`
	DecidedAt *time.Time `json:"decidedAt,omitempty"`
	// For the investigators only.
	Reporter string `json:"reporter,omitempty"`
	Country  string `json:"country,omitempty"`
	Account  string `json:"-"`
}

type New struct {
	Place     string   `json:"place"`
	Link      string   `json:"link"`
	Selling   string   `json:"selling"`
	Code      string   `json:"code"`
	Photos    []string `json:"photos"`
	AINote    string   `json:"aiNote"`
	Anonymous bool     `json:"anonymous"`
	Country   string   `json:"country"`
}

const reportCols = `id, place, link, selling, code, photos, ai_note, anonymous, status, outcome, reward_ngn, points, created_at, decided_at, country, account_id`

func scanReport(r pgx.Row, extra ...any) (Report, error) {
	var x Report
	err := r.Scan(append([]any{&x.ID, &x.Place, &x.Link, &x.Selling, &x.Code, &x.Photos, &x.AINote, &x.Anonymous, &x.Status, &x.Outcome, &x.RewardNGN, &x.Points, &x.CreatedAt, &x.DecidedAt, &x.Country, &x.Account}, extra...)...)
	return x, err
}

func clip(s string, n int) string {
	s = strings.TrimSpace(s)
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}

// Send files a report of a fake seller.
func (st Store) Send(ctx context.Context, accountID string, n New) (Report, error) {
	n.Link, n.Selling, n.AINote = clip(n.Link, 300), clip(n.Selling, 300), clip(n.AINote, 500)
	switch n.Place {
	case "online", "social", "market", "delivered":
	default:
		return Report{}, fmt.Errorf("%w: choose where you saw it", ErrBadInput)
	}
	if len([]rune(n.Link)) < 3 {
		return Report{}, fmt.Errorf("%w: add a link or address", ErrBadInput)
	}
	if len([]rune(n.Selling)) < 3 {
		return Report{}, fmt.Errorf("%w: say what they are selling", ErrBadInput)
	}
	if n.Code = NormCode(n.Code); n.Code != "" && !codeRe.MatchString(n.Code) {
		n.Code = ""
	}
	if len(n.Photos) > 6 {
		return Report{}, fmt.Errorf("%w: up to 6 photos", ErrBadInput)
	}
	for _, p := range n.Photos {
		if !photoRe.MatchString(p) {
			return Report{}, fmt.Errorf("%w: photo", ErrBadInput)
		}
	}
	if n.Photos == nil {
		n.Photos = []string{}
	}
	var today int
	if err := st.DB.QueryRow(ctx, `SELECT count(*) FROM brand_reports WHERE account_id = $1 AND created_at > now() - interval '1 day'`, accountID).Scan(&today); err != nil {
		return Report{}, err
	}
	if today >= ReportsPerDay {
		return Report{}, ErrTooMany
	}
	return scanReport(st.DB.QueryRow(ctx, `INSERT INTO brand_reports (account_id, country, place, link, selling, code, photos, ai_note, anonymous)
	  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING `+reportCols,
		accountID, strings.ToUpper(clip(n.Country, 2)), n.Place, n.Link, n.Selling, n.Code, n.Photos, n.AINote, n.Anonymous))
}

type Reporter struct {
	Name   string `json:"name"`
	Points int    `json:"points"`
	Me     bool   `json:"me"`
}

type Summary struct {
	Points      int        `json:"points"`
	MonthPoints int        `json:"monthPoints"`
	Sent        int        `json:"sent"`
	Confirmed   int        `json:"confirmed"`
	RewardNGN   int        `json:"rewardNgn"`
	Rank        int        `json:"rank"` // 0 until the member has points this month
	Country     string     `json:"country"`
	Reports     []Report   `json:"reports"`
	Top         []Reporter `json:"top"`
}

// ShortName turns "Adaeze Okafor" into "Adaeze O." for public lists.
func ShortName(full string) string {
	w := strings.Fields(full)
	switch len(w) {
	case 0:
		return "Member"
	case 1:
		return w[0]
	}
	last := []rune(w[len(w)-1])
	return w[0] + " " + strings.ToUpper(string(last[0])) + "."
}

const month = `date_trunc('month', now())`

// Rewards is a member's rewards page.
func (st Store) Rewards(ctx context.Context, accountID, country string) (Summary, error) {
	s := Summary{Reports: []Report{}, Top: []Reporter{}}
	err := st.DB.QueryRow(ctx, `SELECT coalesce(sum(points), 0), coalesce(sum(points) FILTER (WHERE decided_at >= `+month+`), 0), count(*),
	    count(*) FILTER (WHERE status = 'confirmed'), coalesce(sum(reward_ngn) FILTER (WHERE status = 'confirmed'), 0),
	    coalesce((SELECT country FROM brand_reports WHERE account_id = $1 AND country <> '' ORDER BY created_at DESC LIMIT 1), '')
	  FROM brand_reports WHERE account_id = $1`, accountID).Scan(&s.Points, &s.MonthPoints, &s.Sent, &s.Confirmed, &s.RewardNGN, &s.Country)
	if err != nil {
		return s, err
	}
	if s.Country == "" {
		s.Country = strings.ToUpper(clip(country, 2))
	}
	rows, err := st.DB.Query(ctx, `SELECT `+reportCols+` FROM brand_reports WHERE account_id = $1 ORDER BY created_at DESC LIMIT 50`, accountID)
	if err != nil {
		return s, err
	}
	if s.Reports, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Report, error) { return scanReport(r) }); err != nil {
		return s, err
	}
	// Each member counts in the country of their latest report.
	board := `WITH home AS (SELECT DISTINCT ON (account_id) account_id, country FROM brand_reports ORDER BY account_id, created_at DESC),
	  pts AS (SELECT r.account_id, sum(r.points) AS p FROM brand_reports r WHERE r.decided_at >= ` + month + ` GROUP BY r.account_id HAVING sum(r.points) > 0)
	  SELECT a.id, a.name, pts.p, rank() OVER (ORDER BY pts.p DESC) FROM pts JOIN home h USING (account_id) JOIN accounts a ON a.id = pts.account_id
	  WHERE h.country = $1 ORDER BY pts.p DESC, a.id`
	rows, err = st.DB.Query(ctx, board, s.Country)
	if err != nil {
		return s, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, name string
		var p, rank int
		if err := rows.Scan(&id, &name, &p, &rank); err != nil {
			return s, err
		}
		if id == accountID {
			s.Rank = rank
		}
		if len(s.Top) < 3 {
			s.Top = append(s.Top, Reporter{Name: ShortName(name), Points: p, Me: id == accountID})
		}
	}
	return s, rows.Err()
}

// Open lists reports waiting for an investigator. Anonymous reporters stay hidden.
func (st Store) Open(ctx context.Context) ([]Report, error) {
	rows, err := st.DB.Query(ctx, `SELECT `+prefixed("r", reportCols)+`, CASE WHEN r.anonymous THEN '' ELSE a.name || ' · ' || a.email END
	  FROM brand_reports r JOIN accounts a ON a.id = r.account_id
	  WHERE r.status IN ('sent', 'checking') OR r.decided_at > now() - interval '7 days' ORDER BY r.status IN ('sent', 'checking') DESC, r.created_at`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Report, error) {
		var who string
		x, err := scanReport(r, &who)
		x.Reporter = who
		return x, err
	})
}

func prefixed(t, cols string) string {
	parts := strings.Split(cols, ", ")
	for i, p := range parts {
		parts[i] = t + "." + p
	}
	return strings.Join(parts, ", ")
}

type Decision struct {
	Status    string `json:"status"` // checking, confirmed, rejected, false
	Outcome   string `json:"outcome"`
	RewardNGN int    `json:"rewardNgn"`
	// What the reward is worth in wallet credit (US cents), worked out by the caller at today's rate.
	CreditCents int `json:"creditCents"`
}

// Decide records an investigator's finding. A confirmed report pays its reward into the
// reporter's wallet once, and earns points; a made-up report costs points.
func (st Store) Decide(ctx context.Context, id string, d Decision) (Report, error) {
	d.Outcome = clip(d.Outcome, 60)
	switch d.Status {
	case "checking", "rejected":
		d.RewardNGN, d.CreditCents = 0, 0
	case "false":
		d.RewardNGN, d.CreditCents = 0, 0
	case "confirmed":
		if d.RewardNGN < MinReward || d.RewardNGN > MaxReward || d.CreditCents <= 0 {
			return Report{}, fmt.Errorf("%w: rewards are ₦5,000 to ₦50,000", ErrBadInput)
		}
		if d.Outcome == "" {
			d.Outcome = "taken down"
		}
	default:
		return Report{}, fmt.Errorf("%w: status", ErrBadInput)
	}
	points := 0
	switch d.Status {
	case "confirmed":
		points = 100 + d.RewardNGN/25
	case "false":
		points = FalsePenalty
	}
	var out Report
	err := pgx.BeginFunc(ctx, st.DB, func(tx pgx.Tx) error {
		var status string
		if err := tx.QueryRow(ctx, `SELECT status FROM brand_reports WHERE id = $1 FOR UPDATE`, id).Scan(&status); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if status != "sent" && status != "checking" {
			return ErrDecided
		}
		decided := d.Status != "checking"
		r, err := scanReport(tx.QueryRow(ctx, `UPDATE brand_reports SET status = $2, outcome = $3, reward_ngn = $4, points = $5,
		    decided_at = CASE WHEN $6 THEN now() END WHERE id = $1 RETURNING `+reportCols, id, d.Status, d.Outcome, d.RewardNGN, points, decided))
		if err != nil {
			return err
		}
		if d.Status == "confirmed" {
			if _, err := tx.Exec(ctx, `INSERT INTO credits (account_id, delta_cents, currency, reason, ref) VALUES ($1, $2, 'USD', 'Brand protection reward', $3)`,
				r.Account, d.CreditCents, "brand:"+id); err != nil {
				return err
			}
		}
		out = r
		return nil
	})
	return out, err
}

// Get is one report, for the investigator's photo links.
func (st Store) Get(ctx context.Context, id string) (Report, error) {
	r, err := scanReport(st.DB.QueryRow(ctx, `SELECT `+reportCols+` FROM brand_reports WHERE id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return r, ErrNotFound
	}
	return r, err
}
