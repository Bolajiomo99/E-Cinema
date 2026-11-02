package exec

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// Content and studios (Figma 82:633): every film, the studios behind them and what waits on a
// decision. Studios self-serve; this is the platform view.

type FilmRow struct {
	Film      string    `json:"film"`
	Studio    string    `json:"studio"`
	Showtime  string    `json:"showtime"`
	Genres    string    `json:"genres"`
	Starts    time.Time `json:"starts"`
	Ends      time.Time `json:"ends"`
	Countries int       `json:"countries"`
	Seats     int       `json:"seats"`
	State     string    `json:"state"` // screening, presale, ended, waiting (submitted, no premiere yet)
}

type PendingStudio struct {
	Name    string    `json:"name"`
	Slug    string    `json:"slug"`
	City    string    `json:"city"`
	Country string    `json:"country"`
	DocsOK  bool      `json:"docsOk"`
	HasDocs bool      `json:"hasDocs"`
	HasBank bool      `json:"hasBank"`
	Rights  bool      `json:"rights"`
	Since   time.Time `json:"since"`
}

type DubLang struct {
	Lang     string `json:"lang"`
	Total    int    `json:"total"`
	Approved int    `json:"approved"`
	Working  int    `json:"working"`
	Failed   int    `json:"failed"`
}

type Content struct {
	Screening      int             `json:"screening"`
	Countries      int             `json:"countries"`
	Studios        int             `json:"studios"`
	StudiosWaiting int             `json:"studiosWaiting"`
	ComingSoon     int             `json:"comingSoon"`
	PreSales       int             `json:"preSales"`
	Rating         float64         `json:"rating"`
	Reviews        int             `json:"reviews"`
	Films          []FilmRow       `json:"films"`
	Pending        []PendingStudio `json:"pending"`
	Dubs           []DubLang       `json:"dubs"`
}

// ContentRoles may read the page; StudioDeciders may also approve studios from it.
var StudioDeciders = []string{"coo"}

func (st Store) Content(ctx context.Context, email string, now time.Time) (Content, error) {
	c := Content{Films: []FilmRow{}, Pending: []PendingStudio{}, Dubs: []DubLang{}}
	if err := st.allowed(ctx, email, "coo", "cmo"); err != nil {
		return c, err
	}
	rows, err := st.DB.Query(ctx, `SELECT * FROM (WITH f AS (
	    SELECT s.film, s.studio, (array_agg(s.id ORDER BY s.starts_at DESC))[1] AS sid, min(s.starts_at) AS starts,
	      max(s.starts_at + make_interval(mins => s.duration_min)) AS ends, array_agg(s.id) AS ids
	    FROM showtimes s GROUP BY 1, 2)
	  SELECT f.film, f.studio, f.sid, coalesce((SELECT u.genres FROM studio_premieres p JOIN studio_uploads u ON u.id = p.upload WHERE p.showtime_id = ANY(f.ids) LIMIT 1), ''),
	    f.starts, f.ends,
	    (SELECT count(DISTINCT upper(trim(a.country)))::int FROM holds h JOIN accounts a ON a.id = h.account_id WHERE h.showtime_id = ANY(f.ids) AND h.status = 'paid' AND coalesce(trim(a.country), '') <> ''),
	    (SELECT coalesce(sum(h.seats), 0)::int FROM holds h WHERE h.showtime_id = ANY(f.ids) AND h.status = 'paid'),
	    CASE WHEN f.ends < $1 THEN 'ended' WHEN f.starts > $1 + interval '1 day' THEN 'presale' ELSE 'screening' END
	  FROM f
	  UNION ALL
	  SELECT u.title, u.studio, '', u.genres, u.updated_at, u.updated_at, 0, 0, 'waiting' FROM studio_uploads u
	  WHERE u.status = 'submitted' AND NOT EXISTS (SELECT 1 FROM studio_premieres p WHERE p.upload = u.id AND p.showtime_id IS NOT NULL)
	) x(film, studio, sid, genres, starts, ends, countries, seats, state) ORDER BY array_position(array['screening','presale','waiting','ended'], state), starts DESC LIMIT 60`, now)
	if err != nil {
		return c, err
	}
	if c.Films, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (FilmRow, error) {
		var f FilmRow
		return f, r.Scan(&f.Film, &f.Studio, &f.Showtime, &f.Genres, &f.Starts, &f.Ends, &f.Countries, &f.Seats, &f.State)
	}); err != nil {
		return c, err
	}
	for _, f := range c.Films {
		switch f.State {
		case "screening":
			c.Screening++
		case "presale":
			c.PreSales++
		}
	}
	if err := st.DB.QueryRow(ctx, `SELECT
	    (SELECT count(DISTINCT upper(trim(a.country)))::int FROM holds h JOIN accounts a ON a.id = h.account_id JOIN showtimes s ON s.id = h.showtime_id
	      WHERE h.status = 'paid' AND coalesce(trim(a.country), '') <> '' AND s.starts_at + make_interval(mins => s.duration_min) >= $1),
	    (SELECT count(*) FILTER (WHERE status = 'verified')::int FROM studios), (SELECT count(*) FILTER (WHERE status = 'submitted')::int FROM studios),
	    (SELECT count(*)::int FROM studio_premieres p LEFT JOIN showtimes s ON s.id = p.showtime_id WHERE p.coming_soon AND (s.id IS NULL OR s.starts_at > $1)),
	    (SELECT coalesce(avg(stars), 0)::float8 FROM reviews WHERE NOT hidden), (SELECT count(*)::int FROM reviews WHERE NOT hidden)`, now).Scan(
		&c.Countries, &c.Studios, &c.StudiosWaiting, &c.ComingSoon, &c.Rating, &c.Reviews); err != nil {
		return c, err
	}
	rows, err = st.DB.Query(ctx, `SELECT name, slug, coalesce(city, ''), coalesce(reg_country, ''), coalesce(docs_ok, false), coalesce(docs_key, '') <> '',
	    coalesce(payout_number, '') <> '' OR coalesce(payout_email, '') <> '', rights_at IS NOT NULL, created_at
	  FROM studios WHERE status = 'submitted' ORDER BY created_at LIMIT 20`)
	if err != nil {
		return c, err
	}
	if c.Pending, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (PendingStudio, error) {
		var p PendingStudio
		return p, r.Scan(&p.Name, &p.Slug, &p.City, &p.Country, &p.DocsOK, &p.HasDocs, &p.HasBank, &p.Rights, &p.Since)
	}); err != nil {
		return c, err
	}
	rows, err = st.DB.Query(ctx, `SELECT lang, count(*)::int, count(*) FILTER (WHERE status = 'approved')::int,
	    count(*) FILTER (WHERE status IN ('translating', 'voicing', 'review'))::int, count(*) FILTER (WHERE status = 'failed')::int
	  FROM studio_dubs GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 8`)
	if err != nil {
		return c, err
	}
	c.Dubs, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (DubLang, error) {
		var d DubLang
		return d, r.Scan(&d.Lang, &d.Total, &d.Approved, &d.Working, &d.Failed)
	})
	return c, err
}

// CanDecideStudios: the CEO and the COO may approve a studio from this page.
func (st Store) CanDecideStudios(ctx context.Context, email string) error {
	return st.allowed(ctx, email, StudioDeciders...)
}

// StudioReady: a waiting studio can be approved from here only once its documents passed the
// desk's check and it accepted the rights terms; anything else goes through the studio desk.
func (st Store) StudioReady(ctx context.Context, slug string) (bool, error) {
	var ok bool
	err := st.DB.QueryRow(ctx, `SELECT coalesce(docs_ok, false) AND rights_at IS NOT NULL FROM studios WHERE slug = $1 AND status = 'submitted'`, slug).Scan(&ok)
	if err == pgx.ErrNoRows {
		return false, ErrNotFound
	}
	return ok, err
}
