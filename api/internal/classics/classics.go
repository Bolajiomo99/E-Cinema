// Package classics runs "Bring back a classic": paid members request older films and the
// studio schedules a one-night screening once a title reaches its goal.
package classics

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound = errors.New("classic not found")
	ErrBadInput = errors.New("check the film details")
	ErrPlan     = errors.New("requesting classics is for Pro and Enterprise members")
)

// Plans that may request (Figma: "Pro and Enterprise only").
var Plans = map[string]bool{"pro": true, "enterprise": true}

type Classic struct {
	ID         string   `json:"id"`
	Title      string   `json:"title"`
	Year       *int     `json:"year,omitempty"`
	FromVault  bool     `json:"fromVault"`
	Goal       int      `json:"goal"`
	Requests   int      `json:"requests"`
	Colors     []string `json:"colors"`
	ShowtimeID *string  `json:"showtimeId,omitempty"`
	Mine       bool     `json:"mine"`
}

type Store struct{ DB *pgxpool.Pool }

const zero = "00000000-0000-0000-0000-000000000000"

func viewer(id string) string {
	if id == "" {
		return zero
	}
	return id
}

// List returns every classic, most requested first.
func (s Store) List(ctx context.Context, accountID string) ([]Classic, error) {
	rows, err := s.DB.Query(ctx, `SELECT c.id, c.title, c.year, c.from_vault, c.goal,
	  (SELECT count(*) FROM classic_votes v WHERE v.classic_id = c.id), c.colors, c.showtime_id,
	  EXISTS (SELECT 1 FROM classic_votes v WHERE v.classic_id = c.id AND v.account_id = $1)
	  FROM classics c
	  ORDER BY (SELECT count(*) FROM classic_votes v WHERE v.classic_id = c.id) DESC, c.from_vault DESC, c.created_at
	  LIMIT 100`, viewer(accountID))
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Classic, error) {
		var c Classic
		err := r.Scan(&c.ID, &c.Title, &c.Year, &c.FromVault, &c.Goal, &c.Requests, &c.Colors, &c.ShowtimeID, &c.Mine)
		return c, err
	})
}

// Vote records one request per member per title. plan is the member's active plan.
func (s Store) Vote(ctx context.Context, id, accountID, plan string) error {
	if !Plans[plan] {
		return ErrPlan
	}
	tag, err := s.DB.Exec(ctx, `INSERT INTO classic_votes (classic_id, account_id) SELECT id, $2 FROM classics WHERE id = $1 ON CONFLICT DO NOTHING`, id, accountID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		var ok bool
		if err := s.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM classics WHERE id = $1)`, id).Scan(&ok); err != nil {
			return err
		}
		if !ok {
			return ErrNotFound
		}
	}
	return nil
}

// Unvote takes a request back.
func (s Store) Unvote(ctx context.Context, id, accountID string) error {
	_, err := s.DB.Exec(ctx, `DELETE FROM classic_votes WHERE classic_id = $1 AND account_id = $2`, id, accountID)
	return err
}

func slug(title string, year int) string {
	var b strings.Builder
	dash := false
	for _, r := range strings.ToLower(title) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			dash = false
		} else if !dash && b.Len() > 0 {
			b.WriteByte('-')
			dash = true
		}
		if b.Len() >= 48 {
			break
		}
	}
	out := strings.Trim(b.String(), "-")
	if year > 0 {
		out = fmt.Sprintf("%s-%d", out, year)
	}
	return out
}

// Suggest adds a film that is not in a vault yet, with the member's own request on it.
// Asking for a title that already exists just adds a request to it.
func (s Store) Suggest(ctx context.Context, accountID, plan, title string, year int) (string, error) {
	if !Plans[plan] {
		return "", ErrPlan
	}
	title = strings.Join(strings.Fields(title), " ")
	if n := utf8.RuneCountInString(title); n < 2 || n > 80 {
		return "", fmt.Errorf("%w: give the film's title", ErrBadInput)
	}
	if year != 0 && (year < 1900 || year > time.Now().Year()) {
		return "", fmt.Errorf("%w: check the year", ErrBadInput)
	}
	id := slug(title, year)
	if len(id) < 3 {
		return "", fmt.Errorf("%w: give the film's title in letters or numbers", ErrBadInput)
	}
	var y any
	if year != 0 {
		y = year
	}
	err := pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO classics (id, title, year, suggested_by) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`, id, title, y, accountID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO classic_votes (classic_id, account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, id, accountID)
		return err
	})
	return id, err
}
