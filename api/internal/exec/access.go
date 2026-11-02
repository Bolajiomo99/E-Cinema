package exec

import (
	"context"
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Access and roles (Figma 49:1307 and 99:1041). Only the CEO grants, changes or removes access;
// a change takes effect on the person's next request because every page checks the role again.

var (
	ErrBadInput = errors.New("bad input")
	ErrNotFound = errors.New("not found")
)

// Scopes an investor or stakeholder can be shown (the chips on the grant form).
var Scopes = []string{"growth", "revenue", "cohorts", "runway", "personal", "recipients"}

// Groups for the summary cards and filter chips.
func Group(role string) string {
	switch role {
	case "ceo":
		return "ceo"
	case "cfo", "coo", "cto", "cmo":
		return "cabinet"
	case "investor":
		return "investors"
	case "stakeholder":
		return "stakeholders"
	}
	return "partners"
}

type Person struct {
	Email      string     `json:"email"`
	Name       string     `json:"name"`
	Org        string     `json:"org"`
	Role       string     `json:"role"`
	Scopes     []string   `json:"scopes"`
	CanAdd     bool       `json:"canAdd"`
	CanMoney   bool       `json:"canMoney"`
	Watermark  bool       `json:"watermark"`
	ExpiresOn  string     `json:"expiresOn"`
	Expired    bool       `json:"expired"`
	Joined     bool       `json:"joined"` // has an E-Cinema account with this email
	LastActive *time.Time `json:"lastActive"`
	AddedAt    time.Time  `json:"addedAt"`
}

type Grant struct {
	Email     string   `json:"email"`
	Name      string   `json:"name"`
	Org       string   `json:"org"`
	Role      string   `json:"role"`
	Scopes    []string `json:"scopes"`
	CanAdd    bool     `json:"canAdd"`
	CanMoney  bool     `json:"canMoney"`
	Watermark bool     `json:"watermark"`
	ExpiresOn string   `json:"expiresOn"` // YYYY-MM-DD or ""
}

func (st Store) ceo(email string) bool {
	email = strings.ToLower(strings.TrimSpace(email))
	return email != "" && slices.Contains(st.CEOs, email)
}

// People lists everyone with executive access, the CEOs first.
func (st Store) People(ctx context.Context, email string) ([]Person, error) {
	if !st.ceo(email) {
		return nil, ErrForbidden
	}
	out := []Person{}
	last := `(SELECT max(s.last_seen_at) FROM account_sessions s JOIN accounts a ON a.id = s.account_id WHERE lower(a.email) = %s)`
	for _, c := range st.CEOs {
		p := Person{Email: c, Role: "ceo", Scopes: []string{}, CanAdd: true, CanMoney: true}
		err := st.DB.QueryRow(ctx, `SELECT coalesce(max(name), ''), count(*) > 0, `+strings.Replace(last, "%s", "$1", 1)+` FROM accounts WHERE lower(email) = $1`, c).Scan(&p.Name, &p.Joined, &p.LastActive)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	rows, err := st.DB.Query(ctx, `SELECT e.email, coalesce(nullif(e.name, ''), a.name, ''), e.org, e.role, e.scopes, e.can_add, e.can_money, e.watermark,
	    coalesce(to_char(e.expires_on, 'YYYY-MM-DD'), ''), e.expires_on IS NOT NULL AND e.expires_on < (now() AT TIME ZONE 'Africa/Lagos')::date,
	    a.id IS NOT NULL, `+strings.Replace(last, "%s", "e.email", 1)+`, e.added_at
	  FROM executives e LEFT JOIN accounts a ON lower(a.email) = e.email ORDER BY e.added_at`)
	if err != nil {
		return nil, err
	}
	more, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Person, error) {
		var p Person
		err := r.Scan(&p.Email, &p.Name, &p.Org, &p.Role, &p.Scopes, &p.CanAdd, &p.CanMoney, &p.Watermark, &p.ExpiresOn, &p.Expired, &p.Joined, &p.LastActive, &p.AddedAt)
		return p, err
	})
	return append(out, more...), err
}

// Grant adds or changes one person's access. Returns true when the person is new.
func (st Store) Grant(ctx context.Context, email, by string, g Grant, now time.Time) (bool, error) {
	if !st.ceo(email) {
		return false, ErrForbidden
	}
	g.Email = strings.ToLower(strings.TrimSpace(g.Email))
	g.Name, g.Org = strings.TrimSpace(g.Name), strings.TrimSpace(g.Org)
	if len(g.Email) > 200 || !strings.Contains(g.Email, "@") || strings.ContainsAny(g.Email, " ,;<>") || len(g.Name) > 80 || len(g.Org) > 80 {
		return false, ErrBadInput
	}
	if st.ceo(g.Email) {
		return false, ErrBadInput
	}
	if Group(g.Role) == "partners" && g.Role != "partner" || g.Role == "ceo" {
		return false, ErrBadInput
	}
	scopes := []string{}
	for _, s := range g.Scopes {
		if slices.Contains(Scopes, s) && !slices.Contains(scopes, s) {
			scopes = append(scopes, s)
		}
	}
	var exp *time.Time
	if g.ExpiresOn != "" {
		d, err := time.Parse("2006-01-02", g.ExpiresOn)
		if err != nil || d.Before(now.Add(-24*time.Hour)) {
			return false, ErrBadInput
		}
		exp = &d
	}
	var added bool
	err := st.DB.QueryRow(ctx, `INSERT INTO executives (email, role, name, org, scopes, can_add, can_money, watermark, expires_on, added_by)
	  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, nullif($10, '')::uuid)
	  ON CONFLICT (email) DO UPDATE SET role = $2, name = $3, org = $4, scopes = $5, can_add = $6, can_money = $7, watermark = $8, expires_on = $9
	  RETURNING xmax = 0`, g.Email, g.Role, g.Name, g.Org, scopes, g.CanAdd, g.CanMoney, g.Watermark, exp, by).Scan(&added)
	return added, err
}

// Revoke removes someone everywhere at once.
func (st Store) Revoke(ctx context.Context, email, target string) error {
	if !st.ceo(email) {
		return ErrForbidden
	}
	tag, err := st.DB.Exec(ctx, `DELETE FROM executives WHERE email = $1`, strings.ToLower(strings.TrimSpace(target)))
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}
