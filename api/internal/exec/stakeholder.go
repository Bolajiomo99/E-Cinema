package exec

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

// Stakeholder view (Figma 83:958): a short read-only summary the CEO shares. Numbers are rounded
// on the page; nothing personal leaves this file.

type StakeDoc struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	Bytes    int64     `json:"bytes"`
	SharedAt time.Time `json:"sharedAt"`
}

type Stakeholder struct {
	Members      int         `json:"members"`
	MembersStart int         `json:"membersStart"` // open accounts at the start of this month
	Revenue      []CurAmount `json:"revenue"`      // E-Cinema's net, this month so far
	RevenuePrev  []CurAmount `json:"revenuePrev"`  // the same days of last month
	Countries    int         `json:"countries"`    // countries members live in
	Milestones   []Milestone `json:"milestones"`
	Note         string      `json:"note"`
	NoteBy       string      `json:"noteBy"`
	NoteAt       *time.Time  `json:"noteAt"`
	Docs         []StakeDoc  `json:"docs"`
	CanEdit      bool        `json:"canEdit"`
}

// CanStake is who reads the stakeholder view: the CEO and stakeholders.
func (st Store) CanStake(ctx context.Context, email string) error {
	return st.allowed(ctx, email, "stakeholder")
}

func (st Store) Stakeholder(ctx context.Context, email string, now time.Time) (Stakeholder, error) {
	s := Stakeholder{Milestones: []Milestone{}, Docs: []StakeDoc{}}
	if err := st.CanStake(ctx, email); err != nil {
		return s, err
	}
	s.CanEdit = st.ceo(email)
	tx, err := st.DB.Begin(ctx)
	if err != nil {
		return s, err
	}
	defer tx.Rollback(ctx)
	month := monthStart(now)
	elapsed := now.Sub(month)
	prev := month.AddDate(0, -1, 0)
	if err := tx.QueryRow(ctx, `SELECT
	    (SELECT count(*) FROM accounts WHERE banned_at IS NULL AND delete_after IS NULL)::int,
	    (SELECT count(*) FROM accounts WHERE banned_at IS NULL AND delete_after IS NULL AND created_at < $1)::int,
	    (SELECT count(DISTINCT upper(trim(country))) FROM accounts WHERE coalesce(trim(country), '') <> '' AND banned_at IS NULL)::int,
	    body, updated_by, updated_at FROM stakeholder_note WHERE id = 1`, month).Scan(&s.Members, &s.MembersStart, &s.Countries, &s.Note, &s.NoteBy, &s.NoteAt); err != nil {
		return s, err
	}
	q := `WITH b AS (` + bookings + `) SELECT cur, sum(net)::bigint FROM b WHERE at >= $1 AND at < $2 AND $3::timestamptz IS NOT NULL GROUP BY 1 ORDER BY 1`
	if s.Revenue, err = sums(ctx, tx, q, month, now, now); err != nil {
		return s, err
	}
	if s.RevenuePrev, err = sums(ctx, tx, q, prev, prev.Add(elapsed), now); err != nil {
		return s, err
	}
	if s.Milestones, err = milestones(ctx, tx); err != nil {
		return s, err
	}
	rows, err := tx.Query(ctx, `SELECT id::text, name, bytes, shared_at FROM stakeholder_docs ORDER BY shared_at DESC LIMIT 30`)
	if err != nil {
		return s, err
	}
	if s.Docs, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (StakeDoc, error) {
		var d StakeDoc
		return d, r.Scan(&d.ID, &d.Name, &d.Bytes, &d.SharedAt)
	}); err != nil {
		return s, err
	}
	return s, tx.Commit(ctx)
}

// SetNote saves the CEO's message to stakeholders.
func (st Store) SetNote(ctx context.Context, email, body string) error {
	if !st.ceo(email) {
		return ErrForbidden
	}
	body = strings.TrimSpace(body)
	if utf8.RuneCountInString(body) > 1200 {
		return fmt.Errorf("%w: keep the message under 1,200 characters", ErrBadInput)
	}
	_, err := st.DB.Exec(ctx, `UPDATE stakeholder_note SET body = $1, updated_by = $2, updated_at = now() WHERE id = 1`, body, strings.ToLower(email))
	return err
}

var boardKey = regexp.MustCompile(`^board/[0-9a-f-]{36}\.pdf$`)

// AddDoc records a PDF the web app has already stored.
func (st Store) AddDoc(ctx context.Context, email, name, key string, bytes int64) (StakeDoc, error) {
	d := StakeDoc{Name: strings.TrimSpace(name), Bytes: bytes}
	if !st.ceo(email) {
		return d, ErrForbidden
	}
	if n := utf8.RuneCountInString(d.Name); n < 1 || n > 120 || !boardKey.MatchString(key) || bytes <= 0 {
		return d, fmt.Errorf("%w: a name and a stored PDF are needed", ErrBadInput)
	}
	err := st.DB.QueryRow(ctx, `INSERT INTO stakeholder_docs (name, object_key, bytes, shared_by) VALUES ($1, $2, $3, $4) RETURNING id::text, shared_at`,
		d.Name, key, bytes, strings.ToLower(email)).Scan(&d.ID, &d.SharedAt)
	return d, err
}

// DocKey returns where a shared document is stored, for someone allowed to read it.
func (st Store) DocKey(ctx context.Context, email, id string) (string, string, error) {
	if err := st.CanStake(ctx, email); err != nil {
		return "", "", err
	}
	var key, name string
	err := st.DB.QueryRow(ctx, `SELECT object_key, name FROM stakeholder_docs WHERE id::text = $1`, id).Scan(&key, &name)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", ErrNotFound
	}
	return key, name, err
}

func (st Store) DeleteDoc(ctx context.Context, email, id string) error {
	if !st.ceo(email) {
		return ErrForbidden
	}
	_, err := st.DB.Exec(ctx, `DELETE FROM stakeholder_docs WHERE id::text = $1`, id)
	return err
}
