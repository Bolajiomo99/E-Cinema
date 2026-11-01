// Package reviews keeps viewers' star ratings and short reviews of the premieres they watched.
package reviews

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrBadInput   = errors.New("invalid input: choose 1 to 5 stars")
	ErrNotWatched = errors.New("only people with a seat can review this film")
	ErrTooSoon    = errors.New("reviews open when the film starts")
)

// Tags are the quick chips on the review card.
var Tags = map[string]bool{"great-story": true, "amazing-music": true, "too-long": true, "great-dub": true, "scary": true, "would-rewatch": true}

const MaxBody = 500

type Store struct{ DB *pgxpool.Pool }

type Review struct {
	Stars     int       `json:"stars"`
	Tags      []string  `json:"tags"`
	Body      string    `json:"body"`
	Name      string    `json:"name,omitempty"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Summary struct {
	Count   int            `json:"count"`
	Average float64        `json:"average"`
	Tags    map[string]int `json:"tags"`
	Recent  []Review       `json:"recent"`
}

// Save records (or updates) the viewer's review. Only ticket holders, once the film has started.
func (s Store) Save(ctx context.Context, accountID, showtimeID string, stars int, tags []string, body string, now time.Time) (Review, error) {
	body = strings.TrimSpace(strings.Map(func(r rune) rune {
		if r == '\n' || r == '\t' {
			return ' '
		}
		if r < 32 {
			return -1
		}
		return r
	}, body))
	if stars < 1 || stars > 5 || utf8.RuneCountInString(body) > MaxBody {
		return Review{}, ErrBadInput
	}
	clean := []string{}
	seen := map[string]bool{}
	for _, t := range tags {
		if Tags[t] && !seen[t] {
			seen[t] = true
			clean = append(clean, t)
		}
	}
	var starts time.Time
	var paid bool
	err := s.DB.QueryRow(ctx, `SELECT st.starts_at, EXISTS (SELECT 1 FROM holds h WHERE h.showtime_id = st.id AND h.account_id = $1 AND h.status = 'paid')
	  FROM showtimes st WHERE st.id = $2`, accountID, showtimeID).Scan(&starts, &paid)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !paid) {
		return Review{}, ErrNotWatched
	}
	if err != nil {
		return Review{}, err
	}
	if now.Before(starts) {
		return Review{}, ErrTooSoon
	}
	r := Review{Stars: stars, Tags: clean, Body: body}
	err = s.DB.QueryRow(ctx, `INSERT INTO reviews (account_id, showtime_id, stars, tags, body) VALUES ($1, $2, $3, $4, $5)
	  ON CONFLICT (account_id, showtime_id) DO UPDATE SET stars = EXCLUDED.stars, tags = EXCLUDED.tags, body = EXCLUDED.body, updated_at = now()
	  RETURNING updated_at`, accountID, showtimeID, stars, clean, body).Scan(&r.UpdatedAt)
	return r, err
}

// Mine returns the viewer's review, or nil.
func (s Store) Mine(ctx context.Context, accountID, showtimeID string) (*Review, error) {
	var r Review
	err := s.DB.QueryRow(ctx, `SELECT stars, tags, body, updated_at FROM reviews WHERE account_id = $1 AND showtime_id = $2`, accountID, showtimeID).
		Scan(&r.Stars, &r.Tags, &r.Body, &r.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &r, err
}

// Summarize gives the film's average, tag counts and the latest written reviews (first names only).
func (s Store) Summarize(ctx context.Context, showtimeID string) (Summary, error) {
	out := Summary{Tags: map[string]int{}, Recent: []Review{}}
	if err := s.DB.QueryRow(ctx, `SELECT count(*), COALESCE(avg(stars), 0) FROM reviews WHERE showtime_id = $1 AND NOT hidden`, showtimeID).Scan(&out.Count, &out.Average); err != nil {
		return out, err
	}
	rows, err := s.DB.Query(ctx, `SELECT t, count(*) FROM reviews, unnest(tags) t WHERE showtime_id = $1 AND NOT hidden GROUP BY t`, showtimeID)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var t string
		var n int
		if err := rows.Scan(&t, &n); err != nil {
			rows.Close()
			return out, err
		}
		out.Tags[t] = n
	}
	rows.Close()
	rows, err = s.DB.Query(ctx, `SELECT r.stars, r.tags, r.body, split_part(a.name, ' ', 1), r.updated_at FROM reviews r JOIN accounts a ON a.id = r.account_id
	  WHERE r.showtime_id = $1 AND NOT r.hidden AND r.body <> '' ORDER BY r.updated_at DESC LIMIT 10`, showtimeID)
	if err != nil {
		return out, err
	}
	out.Recent, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Review, error) {
		var v Review
		err := r.Scan(&v.Stars, &v.Tags, &v.Body, &v.Name, &v.UpdatedAt)
		return v, err
	})
	if out.Recent == nil {
		out.Recent = []Review{}
	}
	return out, err
}
