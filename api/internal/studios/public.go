package studios

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// The public studio page (Figma 597:27). Only verified studios have one, and every number on
// it is counted from real records.

type PageFilm struct {
	ShowtimeID string    `json:"showtimeId"`
	Film       string    `json:"film"`
	StartsAt   time.Time `json:"startsAt"`
	PriceCents int       `json:"priceCents"`
	Rating     float64   `json:"rating"`
	Reviews    int       `json:"reviews"`
	Upload     string    `json:"upload"`
	Poster     bool      `json:"poster"`
}

type Page struct {
	Name       string     `json:"name"`
	Slug       string     `json:"slug"`
	City       string     `json:"city"`
	Country    string     `json:"country"`
	Website    string     `json:"website"`
	Bio        string     `json:"bio"`
	VerifiedAt *time.Time `json:"verifiedAt"`
	Followers  int        `json:"followers"`
	Premieres  int        `json:"premieres"`
	Countries  int        `json:"countries"`
	Following  bool       `json:"following"`
	Coming     []PageFilm `json:"coming"`
	Past       []PageFilm `json:"past"`
}

// PublicPage is the studio page by slug, seen by acct (empty when signed out).
func (st Store) PublicPage(ctx context.Context, slug, acct string, now time.Time) (Page, error) {
	var p Page
	err := st.DB.QueryRow(ctx, `SELECT s.name, s.slug, s.city, s.reg_country, s.website, s.bio, s.verified_at,
	    (SELECT count(*) FROM studio_follows f WHERE f.studio = s.name),
	    EXISTS (SELECT 1 FROM studio_follows f WHERE f.studio = s.name AND f.account_id = NULLIF($2, '')::uuid),
	    (SELECT count(DISTINCT a.country) FROM holds h JOIN showtimes t ON t.id = h.showtime_id JOIN accounts a ON a.id = h.account_id
	      WHERE t.studio = s.name AND h.status = 'paid' AND a.country IS NOT NULL)
	  FROM studios s WHERE s.slug = $1 AND s.status = 'verified'`, slug, acct).
		Scan(&p.Name, &p.Slug, &p.City, &p.Country, &p.Website, &p.Bio, &p.VerifiedAt, &p.Followers, &p.Following, &p.Countries)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, ErrNotFound
	}
	if err != nil {
		return p, err
	}
	rows, err := st.DB.Query(ctx, `SELECT t.id, t.film, t.starts_at, t.price_cents, u.id, u.poster_key <> '',
	    coalesce((SELECT avg(r.stars) FROM reviews r WHERE r.showtime_id = t.id AND NOT r.hidden), 0),
	    (SELECT count(*) FROM reviews r WHERE r.showtime_id = t.id AND NOT r.hidden),
	    t.starts_at + make_interval(mins => t.duration_min) > $2
	  FROM studio_premieres pr JOIN studio_uploads u ON u.id = pr.upload JOIN showtimes t ON t.id = pr.showtime_id
	  WHERE u.studio = $1 AND pr.published_at IS NOT NULL AND t.withdrawn_at IS NULL
	  ORDER BY t.starts_at LIMIT 100`, p.Name, now)
	if err != nil {
		return p, err
	}
	defer rows.Close()
	p.Coming, p.Past = []PageFilm{}, []PageFilm{}
	for rows.Next() {
		var f PageFilm
		var ahead bool
		if err := rows.Scan(&f.ShowtimeID, &f.Film, &f.StartsAt, &f.PriceCents, &f.Upload, &f.Poster, &f.Rating, &f.Reviews, &ahead); err != nil {
			return p, err
		}
		if ahead {
			p.Coming = append(p.Coming, f)
		} else {
			p.Past = append([]PageFilm{f}, p.Past...) // newest first
		}
	}
	p.Premieres = len(p.Coming) + len(p.Past)
	return p, rows.Err()
}

// Follow starts or stops acct following the studio with this slug.
func (st Store) Follow(ctx context.Context, slug, acct string, on bool) (followers int, err error) {
	var name string
	if err := st.DB.QueryRow(ctx, `SELECT name FROM studios WHERE slug = $1 AND status = 'verified'`, slug).Scan(&name); errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNotFound
	} else if err != nil {
		return 0, err
	}
	if on {
		_, err = st.DB.Exec(ctx, `INSERT INTO studio_follows (account_id, studio) VALUES ($1, $2) ON CONFLICT DO NOTHING`, acct, name)
	} else {
		_, err = st.DB.Exec(ctx, `DELETE FROM studio_follows WHERE account_id = $1 AND studio = $2`, acct, name)
	}
	if err != nil {
		return 0, err
	}
	err = st.DB.QueryRow(ctx, `SELECT count(*) FROM studio_follows WHERE studio = $1`, name).Scan(&followers)
	return followers, err
}

// NotifyFollowers tells each follower, in their notifications, about premieres their studio
// published in the last day, once per film.
func (st Store) NotifyFollowers(ctx context.Context, now time.Time) (int, error) {
	tag, err := st.DB.Exec(ctx, `INSERT INTO notifications (account_id, kind, title, body, link, dedupe)
	  SELECT f.account_id, 'premiere', left(u.studio || ' announced ' || t.film, 120),
	    'Premieres ' || to_char(t.starts_at AT TIME ZONE 'UTC', 'FMDay DD Mon, HH24:MI') || ' UTC. Seats are on sale now.', '/film/' || t.id, 'sfollow:' || t.id
	  FROM studio_premieres pr JOIN studio_uploads u ON u.id = pr.upload JOIN showtimes t ON t.id = pr.showtime_id
	  JOIN studio_follows f ON f.studio = u.studio
	  WHERE pr.published_at > $1::timestamptz - interval '1 day' AND pr.published_at <= $1 AND t.withdrawn_at IS NULL AND t.starts_at > $1
	  ON CONFLICT DO NOTHING`, now)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

// SetBio saves the studio's own words for its page.
func (st Store) SetBio(ctx context.Context, acct, email, bio string) (Studio, error) {
	s, err := st.verified(ctx, acct, email, true)
	if err != nil {
		return s, err
	}
	bio = clip(bio, 400)
	if _, err := st.DB.Exec(ctx, `UPDATE studios SET bio = $2 WHERE name = $1`, s.Name, bio); err != nil {
		return s, err
	}
	s.Bio = bio
	return s, nil
}
