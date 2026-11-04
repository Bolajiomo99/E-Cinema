package studios

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Premieres and pricing (Figma 35:514). A studio picks when its film screens, how many seats it
// sells, the house rules and a price per country. Publishing writes the film's showtime, which is
// what checkout, rooms and payouts read, so a published premiere is bookable straight away.

// Price is the ticket price in one country, in that currency's smallest unit.
type Price struct {
	Country     string `json:"country"`
	Currency    string `json:"currency"`
	AmountMinor int64  `json:"amountMinor"`
	Note        string `json:"note"`
	Sold        int    `json:"sold"`
}

type Premiere struct {
	ShowtimeID      *string    `json:"showtimeId"`
	Mode            string     `json:"mode"`
	StartsAt        *time.Time `json:"startsAt"`
	Seats           int        `json:"seats"`
	Encores         int        `json:"encores"`
	PriceCents      int        `json:"priceCents"`
	FreeSeats       bool       `json:"freeSeats"`
	FreePlan        bool       `json:"freePlan"`
	GroupDiscounts  bool       `json:"groupDiscounts"`
	StudentPrice    bool       `json:"studentPrice"`
	ClassicRequests bool       `json:"classicRequests"`
	Downloads       bool       `json:"downloads"`
	PublishedAt     *time.Time `json:"publishedAt"`
	UpdatedAt       *time.Time `json:"updatedAt"`
	Sold            int        `json:"sold"`
	Prices          []Price    `json:"prices"`
	ComingSoon      bool       `json:"comingSoon"`
	EarlySave       int        `json:"earlySave"`
	Formats         []string   `json:"formats"`
}

// PremiereInput is what the studio sends. Publish also writes the showtime.
type PremiereInput struct {
	Mode            string
	StartsAt        time.Time
	Seats           int
	Encores         int
	PriceCents      int
	FreeSeats       bool
	FreePlan        bool
	GroupDiscounts  bool
	StudentPrice    bool
	ClassicRequests bool
	Downloads       bool
	DurationMin     int
	Prices          []Price
	Publish         bool
}

// MaxPrices is the most countries one film can price separately.
const MaxPrices = 250

var (
	countryRe  = regexp.MustCompile(`^[A-Z]{2}$`)
	currencyRe = regexp.MustCompile(`^[A-Z]{3}$`)
)

func defaultPremiere() Premiere {
	return Premiere{Mode: "global", Seats: 5000, Encores: 2, PriceCents: 499, FreeSeats: true, FreePlan: true, GroupDiscounts: true, StudentPrice: true, ClassicRequests: true, Prices: []Price{}, Formats: []string{"hd"}}
}

// Premiere is the film's premiere plan, or the defaults when none is saved yet.
func (st Store) Premiere(ctx context.Context, acct, email, id string) (Premiere, error) {
	s, err := st.verified(ctx, acct, email, false)
	if err != nil {
		return Premiere{}, err
	}
	if _, err := st.upload(ctx, s.Name, id); err != nil {
		return Premiere{}, err
	}
	return st.premiere(ctx, id)
}

func (st Store) premiere(ctx context.Context, id string) (Premiere, error) {
	p := defaultPremiere()
	err := st.DB.QueryRow(ctx, `SELECT showtime_id, mode, starts_at, seats, encores, price_cents, free_seats, free_plan, group_discounts, student_price, classic_requests, downloads, published_at, updated_at,
	    coming_soon, early_save, formats
	  FROM studio_premieres WHERE upload = $1`, id).Scan(&p.ShowtimeID, &p.Mode, &p.StartsAt, &p.Seats, &p.Encores, &p.PriceCents, &p.FreeSeats, &p.FreePlan, &p.GroupDiscounts, &p.StudentPrice, &p.ClassicRequests, &p.Downloads, &p.PublishedAt, &p.UpdatedAt,
		&p.ComingSoon, &p.EarlySave, &p.Formats)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return p, err
	}
	// Seats sold in each country come from the buyers' account country; guests have none.
	sold := map[string]int{}
	if p.ShowtimeID != nil {
		rows, err := st.DB.Query(ctx, `SELECT coalesce(a.country, ''), sum(h.seats)::int FROM holds h LEFT JOIN accounts a ON a.id = h.account_id
		  WHERE h.showtime_id = $1 AND h.status = 'paid' GROUP BY 1`, *p.ShowtimeID)
		if err != nil {
			return p, err
		}
		for rows.Next() {
			var c string
			var n int
			if err := rows.Scan(&c, &n); err != nil {
				rows.Close()
				return p, err
			}
			sold[c] = n
			p.Sold += n
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return p, err
		}
	}
	rows, err := st.DB.Query(ctx, `SELECT country, currency, amount_minor, note FROM studio_prices WHERE upload = $1 ORDER BY country`, id)
	if err != nil {
		return p, err
	}
	p.Prices, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Price, error) {
		var x Price
		err := r.Scan(&x.Country, &x.Currency, &x.AmountMinor, &x.Note)
		x.Country, x.Currency = strings.TrimSpace(x.Country), strings.TrimSpace(x.Currency)
		x.Sold = sold[x.Country]
		return x, err
	})
	return p, err
}

// badInput is ErrBadInput with a message the studio reads as is.
type badInput string

func (b badInput) Error() string { return string(b) }
func (b badInput) Unwrap() error { return ErrBadInput }

func bad(msg string) error { return badInput(strings.ToUpper(msg[:1]) + msg[1:] + ".") }

// SavePremiere stores the plan and, with Publish, puts the film on sale.
func (st Store) SavePremiere(ctx context.Context, acct, email, id string, in PremiereInput, now time.Time) (Premiere, error) {
	s, err := st.verified(ctx, acct, email, true)
	if err != nil {
		return Premiere{}, err
	}
	u, err := st.upload(ctx, s.Name, id)
	if err != nil {
		return Premiere{}, err
	}
	switch {
	case in.Mode != "global" && in.Mode != "rolling" && in.Mode != "waves":
		return Premiere{}, bad("pick a premiere mode")
	case in.Seats < 10 || in.Seats > 1000000:
		return Premiere{}, bad("seats must be between 10 and 1,000,000")
	case in.Encores < 0 || in.Encores > 5:
		return Premiere{}, bad("up to 5 encores")
	case in.PriceCents < 99 || in.PriceCents > 10000:
		return Premiere{}, bad("the base price must be between $0.99 and $100")
	case len(in.Prices) > MaxPrices:
		return Premiere{}, bad("too many countries")
	}
	seen := map[string]bool{}
	for i, p := range in.Prices {
		p.Country, p.Currency, p.Note = strings.ToUpper(strings.TrimSpace(p.Country)), strings.ToUpper(strings.TrimSpace(p.Currency)), clip(p.Note, 160)
		if !countryRe.MatchString(p.Country) || !currencyRe.MatchString(p.Currency) || p.AmountMinor <= 0 || p.AmountMinor >= 100000000000 || seen[p.Country] {
			return Premiere{}, bad("check the country prices")
		}
		seen[p.Country] = true
		in.Prices[i] = p
	}
	cur, err := st.premiere(ctx, id)
	if err != nil {
		return Premiere{}, err
	}
	var starts *time.Time
	if !in.StartsAt.IsZero() {
		t := in.StartsAt.UTC().Truncate(time.Minute)
		starts = &t
	}
	if in.Publish {
		if err := st.canPublish(ctx, s, u, cur, in, starts, now); err != nil {
			return Premiere{}, err
		}
	}

	tx, err := st.DB.Begin(ctx)
	if err != nil {
		return Premiere{}, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `INSERT INTO studio_premieres (upload, mode, starts_at, seats, encores, price_cents, free_seats, free_plan, group_discounts, student_price, classic_requests, downloads)
	  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
	  ON CONFLICT (upload) DO UPDATE SET mode = $2, starts_at = $3, seats = $4, encores = $5, price_cents = $6, free_seats = $7, free_plan = $8, group_discounts = $9,
	    student_price = $10, classic_requests = $11, downloads = $12, updated_at = now()`,
		id, in.Mode, starts, in.Seats, in.Encores, in.PriceCents, in.FreeSeats, in.FreePlan, in.GroupDiscounts, in.StudentPrice, in.ClassicRequests, in.Downloads); err != nil {
		return Premiere{}, err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM studio_prices WHERE upload = $1`, id); err != nil {
		return Premiere{}, err
	}
	for _, p := range in.Prices {
		if _, err := tx.Exec(ctx, `INSERT INTO studio_prices (upload, country, currency, amount_minor, note) VALUES ($1, $2, $3, $4, $5)`, id, p.Country, p.Currency, p.AmountMinor, p.Note); err != nil {
			return Premiere{}, err
		}
	}
	if in.Publish {
		adult := strings.HasPrefix(strings.TrimSpace(u.AgeRating), "18")
		if cur.ShowtimeID != nil {
			if _, err := tx.Exec(ctx, `UPDATE showtimes SET film = $2, starts_at = $3, duration_min = $4, capacity = $5, price_cents = $6, adult = $7 WHERE id = $1`,
				*cur.ShowtimeID, u.Title, *starts, in.DurationMin, in.Seats, in.PriceCents, adult); err != nil {
				return Premiere{}, err
			}
		} else {
			sid := slugOf(u.Title) + "-" + starts.Format("2006-01-02")
			var taken bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM showtimes WHERE id = $1)`, sid).Scan(&taken); err != nil {
				return Premiere{}, err
			}
			if taken {
				sid += "-" + id[:6]
			}
			if _, err := tx.Exec(ctx, `INSERT INTO showtimes (id, film, studio, starts_at, duration_min, capacity, price_cents, currency, adult) VALUES ($1, $2, $3, $4, $5, $6, $7, 'USD', $8)`,
				sid, u.Title, s.Name, *starts, in.DurationMin, in.Seats, in.PriceCents, adult); err != nil {
				return Premiere{}, err
			}
			if _, err := tx.Exec(ctx, `UPDATE studio_premieres SET showtime_id = $2 WHERE upload = $1`, id, sid); err != nil {
				return Premiere{}, err
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE studio_premieres SET published_at = now() WHERE upload = $1`, id); err != nil {
			return Premiere{}, err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE studio_uploads SET updated_at = now() WHERE id = $1`, id); err != nil {
		return Premiere{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Premiere{}, err
	}
	return st.premiere(ctx, id)
}

// canPublish holds back a premiere that viewers could not watch or that would break tickets sold.
func (st Store) canPublish(ctx context.Context, s Studio, u Upload, cur Premiere, in PremiereInput, starts *time.Time, now time.Time) error {
	master := false
	for _, f := range u.Files {
		if f.Kind == "master" && f.Status == "uploaded" {
			master = true
		}
	}
	// A coming-soon post can go on sale before the full film is in, if release is a week away or more.
	early := cur.ComingSoon && starts != nil && !starts.Before(now.Add(ComingSoonLead))
	switch {
	case in.Mode != "global":
		return bad("rolling and regional premieres are coming soon; pick one global moment")
	case !master && cur.ComingSoon && !early:
		return bad("upload the picture master first; without it the release must be at least 7 days away")
	case !master && !early:
		return bad("upload the picture master first")
	case s.RightsAt == nil:
		return bad("declare your rights in Settings first")
	case starts == nil:
		return bad("pick the premiere date and time")
	case in.DurationMin < 1 || in.DurationMin > 600:
		return bad("the film's running time is missing; check the master file")
	}
	moved := cur.StartsAt == nil || !cur.StartsAt.Equal(*starts)
	if moved && starts.Before(now.Add(time.Hour)) {
		return bad("the premiere must start at least an hour from now")
	}
	if moved && cur.Sold > 0 {
		return bad("tickets are sold; use Reschedule so every ticket holder is told")
	}
	if in.Seats < cur.Sold {
		return bad(fmt.Sprintf("%d seats are already sold", cur.Sold))
	}
	return nil
}

// ComingSoonLead is how far ahead a film without its master can be put on sale.
const ComingSoonLead = 7 * 24 * time.Hour

// Formats a coming-soon film can offer.
var Formats = map[string]bool{"hd": true, "uhd": true, "atmos": true, "vr": true, "ar": true, "3d": true}

// ComingSoonInput is the coming-soon part of a premiere: the early-bird saving and the formats.
type ComingSoonInput struct {
	EarlySave int      `json:"earlySave"`
	Formats   []string `json:"formats"`
}

// SaveComingSoon marks the film as a coming-soon post with its early-bird saving and formats.
// Publishing still goes through SavePremiere.
func (st Store) SaveComingSoon(ctx context.Context, acct, email, id string, in ComingSoonInput) (Premiere, error) {
	s, err := st.verified(ctx, acct, email, true)
	if err != nil {
		return Premiere{}, err
	}
	if _, err := st.upload(ctx, s.Name, id); err != nil {
		return Premiere{}, err
	}
	if in.EarlySave < 0 || in.EarlySave > 60 {
		return Premiere{}, bad("the early-bird saving must be between 0% and 60%")
	}
	seen := map[string]bool{}
	formats := []string{}
	for _, f := range in.Formats {
		if !Formats[f] {
			return Premiere{}, bad("unknown format")
		}
		if !seen[f] {
			seen[f] = true
			formats = append(formats, f)
		}
	}
	if !seen["hd"] && !seen["uhd"] {
		return Premiere{}, bad("offer 1080p or 4K at least")
	}
	d := defaultPremiere()
	if _, err := st.DB.Exec(ctx, `INSERT INTO studio_premieres (upload, mode, seats, encores, price_cents, free_seats, free_plan, group_discounts, student_price, classic_requests, coming_soon, early_save, formats)
	  VALUES ($1, 'global', $2, $3, $4, $5, $6, $7, $8, $9, true, $10, $11)
	  ON CONFLICT (upload) DO UPDATE SET coming_soon = true, early_save = $10, formats = $11, updated_at = now()`,
		id, d.Seats, d.Encores, d.PriceCents, d.FreeSeats, d.FreePlan, d.GroupDiscounts, d.StudentPrice, d.ClassicRequests, in.EarlySave, formats); err != nil {
		return Premiere{}, err
	}
	return st.premiere(ctx, id)
}

// LiveFilm is a published studio premiere as the public site lists it.
type LiveFilm struct {
	ShowtimeID  string           `json:"showtimeId"`
	Upload      string           `json:"upload"`
	Film        string           `json:"film"`
	Studio      string           `json:"studio"`
	StartsAt    time.Time        `json:"startsAt"`
	DurationMin int              `json:"durationMin"`
	PriceCents  int              `json:"priceCents"`
	Adult       bool             `json:"adult"`
	Logline     string           `json:"logline"`
	Genres      string           `json:"genres"`
	AgeRating   string           `json:"ageRating"`
	Languages   string           `json:"languages"`
	Poster      bool             `json:"poster"`
	Format      string           `json:"format"`
	Prices      map[string]Price `json:"prices"`
	EarlySave   int              `json:"earlySave"`
	Formats     []string         `json:"formats"`
	HasMaster   bool             `json:"hasMaster"`
}

// LiveFilms lists every published studio premiere that has not ended more than a day ago.
func (st Store) LiveFilms(ctx context.Context) ([]LiveFilm, error) {
	rows, err := st.DB.Query(ctx, `SELECT s.id, u.id, s.film, s.studio, s.starts_at, s.duration_min, s.price_cents, s.adult, u.logline, u.genres, u.age_rating, u.languages, u.poster_key <> '',
	    coalesce((SELECT f.info FROM studio_upload_files f WHERE f.upload_id = u.id AND f.kind = 'master' AND f.status = 'uploaded' LIMIT 1), ''),
	    p.early_save, p.formats, EXISTS (SELECT 1 FROM studio_upload_files f WHERE f.upload_id = u.id AND f.kind = 'master' AND f.status = 'uploaded')
	  FROM studio_premieres p JOIN studio_uploads u ON u.id = p.upload JOIN showtimes s ON s.id = p.showtime_id
	  WHERE p.published_at IS NOT NULL AND s.withdrawn_at IS NULL AND s.starts_at + make_interval(mins => s.duration_min) > now() - interval '1 day'
	  ORDER BY s.starts_at LIMIT 200`)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (LiveFilm, error) {
		var f LiveFilm
		err := r.Scan(&f.ShowtimeID, &f.Upload, &f.Film, &f.Studio, &f.StartsAt, &f.DurationMin, &f.PriceCents, &f.Adult, &f.Logline, &f.Genres, &f.AgeRating, &f.Languages, &f.Poster, &f.Format, &f.EarlySave, &f.Formats, &f.HasMaster)
		return f, err
	})
	if err != nil {
		return nil, err
	}
	for i := range out {
		out[i].Prices = map[string]Price{}
		pr, err := st.DB.Query(ctx, `SELECT country, currency, amount_minor FROM studio_prices WHERE upload = $1`, out[i].Upload)
		if err != nil {
			return nil, err
		}
		for pr.Next() {
			var x Price
			if err := pr.Scan(&x.Country, &x.Currency, &x.AmountMinor); err != nil {
				pr.Close()
				return nil, err
			}
			out[i].Prices[strings.TrimSpace(x.Country)] = Price{Country: strings.TrimSpace(x.Country), Currency: strings.TrimSpace(x.Currency), AmountMinor: x.AmountMinor}
		}
		pr.Close()
	}
	return out, nil
}

// LivePosterKey is the stored poster of a published film, for the public poster link.
func (st Store) LivePosterKey(ctx context.Context, upload string) (string, error) {
	if !uuidRe.MatchString(upload) {
		return "", ErrNotFound
	}
	var key string
	err := st.DB.QueryRow(ctx, `SELECT u.poster_key FROM studio_uploads u JOIN studio_premieres p ON p.upload = u.id WHERE u.id = $1 AND p.published_at IS NOT NULL AND u.poster_key <> ''`, upload).Scan(&key)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return key, err
}

// LiveShowtime is the published screening of one of the studio's films, for the control room.
// write asks for the edit role (messaging viewers, moderating chat).
func (st Store) LiveShowtime(ctx context.Context, acct, email, id string, write bool) (showtime, studio string, err error) {
	s, err := st.verified(ctx, acct, email, write)
	if err != nil {
		return "", "", err
	}
	if !uuidRe.MatchString(id) {
		return "", "", ErrNotFound
	}
	var sid *string
	err = st.DB.QueryRow(ctx, `SELECT p.showtime_id FROM studio_premieres p JOIN studio_uploads u ON u.id = p.upload WHERE p.upload = $1 AND u.studio = $2`, id, s.Name).Scan(&sid)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && sid == nil) {
		return "", s.Name, ErrNotLive
	}
	if err != nil {
		return "", "", err
	}
	return *sid, s.Name, nil
}
