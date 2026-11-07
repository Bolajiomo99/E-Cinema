package licensing

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// Case is a compliance case the brand team opened against a partner (email 43, Figma 127:435).
type Case struct {
	ID          int        `json:"id"`
	Number      string     `json:"number"` // CMP-0057
	Licence     string     `json:"licence"`
	Company     string     `json:"company,omitempty"`
	Issue       string     `json:"issue"`   // "unlabelled caps"
	Place       string     `json:"place"`   // "Kano"
	Finding     string     `json:"finding"` // what the investigator found
	FixBy       string     `json:"fixBy"`
	Status      string     `json:"status"`
	PartnerNote string     `json:"partnerNote"`
	CreatedAt   time.Time  `json:"createdAt"`
	ResolvedAt  *time.Time `json:"resolvedAt,omitempty"`
}

func CaseNumber(id int) string { return fmt.Sprintf("CMP-%04d", id) }

const caseCols = `c.id, c.licence, b.name, c.issue, c.place, c.finding, to_char(c.fix_by, 'YYYY-MM-DD'), c.status, c.partner_note, c.created_at, c.resolved_at`

func scanCase(row pgx.Row) (Case, error) {
	var c Case
	err := row.Scan(&c.ID, &c.Licence, &c.Company, &c.Issue, &c.Place, &c.Finding, &c.FixBy, &c.Status, &c.PartnerNote, &c.CreatedAt, &c.ResolvedAt)
	c.Number = CaseNumber(c.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, ErrNotFound
	}
	return c, err
}

func listCases(ctx context.Context, st Store, where string, args ...any) ([]Case, error) {
	rows, err := st.DB.Query(ctx, `SELECT `+caseCols+` FROM licence_cases c JOIN brand_licensees b USING (licence) WHERE `+where+` ORDER BY c.created_at DESC LIMIT 100`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Case{}
	for rows.Next() {
		c, err := scanCase(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// OpenCase records a finding against a licence and gives the partner days to fix it.
func (st Store) OpenCase(ctx context.Context, licence, issue, place, finding string, days int) (Case, error) {
	issue, place, finding = clip(issue, 80), clip(place, 60), clip(finding, 600)
	if issue == "" || finding == "" || days < 1 || days > 60 {
		return Case{}, fmt.Errorf("%w: say what was found and give 1 to 60 days to fix it", ErrBadInput)
	}
	var id int
	err := st.DB.QueryRow(ctx, `INSERT INTO licence_cases (licence, issue, place, finding, fix_by)
	  SELECT licence, $2, $3, $4, current_date + $5::int FROM brand_licensees WHERE licence = $1 AND status <> 'ended' RETURNING id`,
		licence, issue, place, finding, days).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return Case{}, ErrNotFound
	}
	if err != nil {
		return Case{}, err
	}
	return scanCase(st.DB.QueryRow(ctx, `SELECT `+caseCols+` FROM licence_cases c JOIN brand_licensees b USING (licence) WHERE c.id = $1`, id))
}

// Cases lists a partner's compliance cases, newest first.
func (st Store) Cases(ctx context.Context, l Licensee) ([]Case, error) {
	return listCases(ctx, st, `c.licence = $1`, l.Licence)
}

// DeskCases lists the cases the brand team still has to act on.
func (st Store) DeskCases(ctx context.Context) ([]Case, error) {
	return listCases(ctx, st, `c.status IN ('open', 'fixed')`)
}

// CaseFixed is the partner saying the problem is fixed; the brand team then checks.
func (st Store) CaseFixed(ctx context.Context, l Licensee, id int, note string) (Case, error) {
	note = clip(note, 600)
	if note == "" {
		return Case{}, fmt.Errorf("%w: say what you changed", ErrBadInput)
	}
	tag, err := st.DB.Exec(ctx, `UPDATE licence_cases SET status = 'fixed', partner_note = $3 WHERE id = $1 AND licence = $2 AND status IN ('open', 'fixed')`, id, l.Licence, note)
	if err != nil {
		return Case{}, err
	}
	if tag.RowsAffected() == 0 {
		return Case{}, ErrNotFound
	}
	return scanCase(st.DB.QueryRow(ctx, `SELECT `+caseCols+` FROM licence_cases c JOIN brand_licensees b USING (licence) WHERE c.id = $1`, id))
}

// DecideCase closes a case once fixed, or suspends the licence when it was not.
func (st Store) DecideCase(ctx context.Context, id int, outcome string) (Case, error) {
	if outcome != "closed" && outcome != "suspended" {
		return Case{}, fmt.Errorf("%w: outcome", ErrBadInput)
	}
	err := pgx.BeginFunc(ctx, st.DB, func(tx pgx.Tx) error {
		var licence string
		err := tx.QueryRow(ctx, `UPDATE licence_cases SET status = $2, resolved_at = now() WHERE id = $1 AND status IN ('open', 'fixed') RETURNING licence`, id, outcome).Scan(&licence)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if outcome == "suspended" {
			_, err = tx.Exec(ctx, `UPDATE brand_licensees SET status = 'suspended' WHERE licence = $1 AND status = 'active'`, licence)
		}
		return err
	})
	if err != nil {
		return Case{}, err
	}
	return scanCase(st.DB.QueryRow(ctx, `SELECT `+caseCols+` FROM licence_cases c JOIN brand_licensees b USING (licence) WHERE c.id = $1`, id))
}
