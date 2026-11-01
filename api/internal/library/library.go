// Package library is the viewer's own shelf (Figma "Web / Library" 19:583): films they saw
// (replayable for 30 days after the premiere), films they bought to keep, the classics they
// asked for and their collections.
package library

import (
	"context"
	"errors"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ReplayWindow is how long a premiere seat lets the viewer watch again after the film ends.
const ReplayWindow = 30 * 24 * time.Hour

var uuidRe = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// MaxCollections keeps one account from filling the table.
const MaxCollections = 50

var (
	ErrNotFound   = errors.New("not in your library")
	ErrBadInput   = errors.New("check the collection details")
	ErrNoSeat     = errors.New("only people who watched the premiere can keep this film")
	ErrNotEnded   = errors.New("films can be kept once the premiere has ended")
	ErrOwned      = errors.New("you already own this film")
	ErrTooMany    = errors.New("you have the most collections allowed")
	ErrNoFriend   = errors.New("no E-Cinema account uses that email")
	ErrShareSelf  = errors.New("that is your own account")
	ErrNotOwner   = errors.New("only the owner can change this collection")
	ErrReplayGone = errors.New("the replay window has closed; keep the film to watch again")
)

type Store struct{ DB *pgxpool.Pool }

type Item struct {
	ShowtimeID string     `json:"showtimeId"`
	Film       string     `json:"film"`
	Quality    string     `json:"quality"`
	Owned      bool       `json:"owned"`
	ExpiresAt  *time.Time `json:"expiresAt,omitempty"`
	AddedAt    time.Time  `json:"addedAt"`
}

// Items lists what the viewer may play now, newest first.
func (s Store) Items(ctx context.Context, accountID string, now time.Time) ([]Item, error) {
	rows, err := s.DB.Query(ctx, `
	  WITH seats AS (
	    SELECT h.showtime_id,
	      CASE WHEN bool_or(h.quality IN ('4k', 'vr')) THEN '4k' ELSE 'hd' END AS quality,
	      min(st.starts_at + make_interval(mins => st.duration_min)) AS ends
	    FROM holds h JOIN showtimes st ON st.id = h.showtime_id
	    WHERE h.account_id = $1 AND h.status = 'paid' AND st.starts_at + make_interval(mins => st.duration_min) <= $2
	    GROUP BY h.showtime_id),
	  keeps AS (SELECT showtime_id, quality, paid_at FROM library_keeps WHERE account_id = $1 AND status = 'paid')
	  SELECT st.id, st.film, coalesce(k.quality, se.quality), k.showtime_id IS NOT NULL, se.ends, k.paid_at
	  FROM seats se FULL JOIN keeps k ON k.showtime_id = se.showtime_id
	  JOIN showtimes st ON st.id = coalesce(k.showtime_id, se.showtime_id)`, accountID, now)
	if err != nil {
		return nil, err
	}
	all, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Item, error) {
		var it Item
		var ends, paid *time.Time
		err := r.Scan(&it.ShowtimeID, &it.Film, &it.Quality, &it.Owned, &ends, &paid)
		switch {
		case paid != nil:
			it.AddedAt = *paid
		case ends != nil:
			it.AddedAt = *ends
		}
		if !it.Owned && ends != nil {
			exp := ends.Add(ReplayWindow)
			it.ExpiresAt = &exp
		}
		return it, err
	})
	if err != nil {
		return nil, err
	}
	out := all[:0]
	for _, it := range all {
		if it.Owned || (it.ExpiresAt != nil && it.ExpiresAt.After(now)) {
			out = append(out, it)
		}
	}
	slices.SortFunc(out, func(a, b Item) int { return b.AddedAt.Compare(a.AddedAt) })
	return out, nil
}

// Access says whether the viewer may play a film from their library right now.
func (s Store) Access(ctx context.Context, accountID, showtimeID string, now time.Time) (Item, error) {
	items, err := s.Items(ctx, accountID, now)
	if err != nil {
		return Item{}, err
	}
	for _, it := range items {
		if it.ShowtimeID == showtimeID {
			return it, nil
		}
	}
	var seat bool
	if err := s.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM holds WHERE account_id = $1 AND showtime_id = $2 AND status = 'paid')`, accountID, showtimeID).Scan(&seat); err != nil {
		return Item{}, err
	}
	if seat {
		return Item{}, ErrReplayGone
	}
	return Item{}, ErrNotFound
}

// AttachKeep records the PayPal order that buys a film to keep. Only for people who had a
// seat, after the premiere ends. A newer order replaces an unpaid one.
func (s Store) AttachKeep(ctx context.Context, accountID, showtimeID, quality, orderID string, cents int, currency string) error {
	if orderID == "" || cents <= 0 || len(currency) != 3 || (quality != "hd" && quality != "4k") {
		return ErrBadInput
	}
	return pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		var ended bool
		err := tx.QueryRow(ctx, `SELECT starts_at + make_interval(mins => duration_min) <= now() FROM showtimes WHERE id = $1`, showtimeID).Scan(&ended)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if !ended {
			return ErrNotEnded
		}
		var seat bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM holds WHERE account_id = $1 AND showtime_id = $2 AND status = 'paid')`, accountID, showtimeID).Scan(&seat); err != nil {
			return err
		}
		if !seat {
			return ErrNoSeat
		}
		tag, err := tx.Exec(ctx, `INSERT INTO library_keeps (account_id, showtime_id, quality, amount_cents, currency, paypal_order_id)
		  VALUES ($1, $2, $3, $4, $5, $6)
		  ON CONFLICT (account_id, showtime_id) DO UPDATE SET paypal_order_id = EXCLUDED.paypal_order_id, quality = EXCLUDED.quality,
		    amount_cents = EXCLUDED.amount_cents, currency = EXCLUDED.currency, created_at = now()
		  WHERE library_keeps.status = 'pending'`, accountID, showtimeID, quality, cents, currency, orderID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrOwned
		}
		return nil
	})
}

// MarkKeepPaid confirms a keep order by its PayPal order. It reports whether the order was a keep.
func (s Store) MarkKeepPaid(ctx context.Context, orderID, captureID string) (bool, error) {
	tag, err := s.DB.Exec(ctx, `UPDATE library_keeps SET status = 'paid', paypal_capture_id = $2, paid_at = coalesce(paid_at, now())
	  WHERE paypal_order_id = $1 AND (status = 'pending' OR paypal_capture_id = $2)`, orderID, captureID)
	if err != nil {
		return false, err
	}
	if tag.RowsAffected() > 0 {
		return true, nil
	}
	var known bool
	err = s.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM library_keeps WHERE paypal_order_id = $1)`, orderID).Scan(&known)
	return known, err
}

// Request is a classic the viewer asked for, with where it stands.
type Request struct {
	ID        string     `json:"id"`
	Title     string     `json:"title"`
	Year      *int       `json:"year,omitempty"`
	Votes     int        `json:"votes"`
	Goal      int        `json:"goal"`
	Status    string     `json:"status"` // yes, talks, blocked, sent
	StartsAt  *time.Time `json:"startsAt,omitempty"`
	Showtime  *string    `json:"showtimeId,omitempty"`
	Colors    []string   `json:"colors"`
	Requested time.Time  `json:"requestedAt"`
}

// Requested lists the classics the viewer voted for, newest first.
func (s Store) Requested(ctx context.Context, accountID string) ([]Request, error) {
	rows, err := s.DB.Query(ctx, `SELECT c.id, c.title, c.year,
	    (SELECT count(*) FROM classic_votes x WHERE x.classic_id = c.id), c.goal, c.showtime_id, st.starts_at,
	    c.rights_talks, coalesce(a.country, '') = ANY (c.blocked_countries), c.colors, v.created_at
	  FROM classic_votes v JOIN classics c ON c.id = v.classic_id
	  JOIN accounts a ON a.id = v.account_id
	  LEFT JOIN showtimes st ON st.id = c.showtime_id
	  WHERE v.account_id = $1 ORDER BY v.created_at DESC LIMIT 100`, accountID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Request, error) {
		var q Request
		var talks, blocked bool
		err := r.Scan(&q.ID, &q.Title, &q.Year, &q.Votes, &q.Goal, &q.Showtime, &q.StartsAt, &talks, &blocked, &q.Colors, &q.Requested)
		switch {
		case q.Showtime != nil:
			q.Status = "yes"
		case blocked:
			q.Status = "blocked"
		case talks || q.Votes >= q.Goal:
			q.Status = "talks"
		default:
			q.Status = "sent"
		}
		return q, err
	})
}

// Collection is a named shelf of films.
type Collection struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Kids      bool      `json:"kids"`
	Colors    []string  `json:"colors"`
	Films     []string  `json:"films"` // showtime ids, newest first
	SharedTo  []string  `json:"sharedWith"`
	Mine      bool      `json:"mine"`
	Owner     string    `json:"owner,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// Shelf colours, picked in turn for new collections (Figma 101:1208).
var palette = [][]string{{"#3a0d12", "#120406"}, {"#1d1440", "#0b0819"}, {"#0f3324", "#06140e"}, {"#3b2a0a", "#160f04"}, {"#102a3a", "#05121a"}, {"#2e0a2c", "#120411"}}

func cleanName(name string) (string, error) {
	name = strings.Join(strings.Fields(name), " ")
	if n := utf8.RuneCountInString(name); n < 1 || n > 40 {
		return "", ErrBadInput
	}
	for _, r := range name {
		if r < 32 {
			return "", ErrBadInput
		}
	}
	return name, nil
}

// Collections lists the viewer's own collections and the ones friends shared with them.
func (s Store) Collections(ctx context.Context, accountID string) ([]Collection, error) {
	rows, err := s.DB.Query(ctx, `SELECT c.id, c.name, c.kids, c.colors, c.account_id = $1, owner.name, c.created_at,
	    coalesce((SELECT array_agg(f.showtime_id ORDER BY f.added_at DESC) FROM collection_films f WHERE f.collection_id = c.id), '{}'),
	    CASE WHEN c.account_id = $1 THEN coalesce((SELECT array_agg(a.name ORDER BY sh.created_at) FROM collection_shares sh JOIN accounts a ON a.id = sh.account_id WHERE sh.collection_id = c.id), '{}') ELSE '{}' END
	  FROM collections c JOIN accounts owner ON owner.id = c.account_id
	  WHERE c.account_id = $1 OR EXISTS (SELECT 1 FROM collection_shares sh WHERE sh.collection_id = c.id AND sh.account_id = $1)
	  ORDER BY c.account_id = $1 DESC, c.created_at`, accountID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Collection, error) {
		var c Collection
		var owner string
		err := r.Scan(&c.ID, &c.Name, &c.Kids, &c.Colors, &c.Mine, &owner, &c.CreatedAt, &c.Films, &c.SharedTo)
		if !c.Mine {
			c.Owner = owner
		}
		return c, err
	})
}

// CreateCollection adds a new, empty collection.
func (s Store) CreateCollection(ctx context.Context, accountID, name string, kids bool) (Collection, error) {
	name, err := cleanName(name)
	if err != nil {
		return Collection{}, err
	}
	var c Collection
	err = pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		var n int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM collections WHERE account_id = $1`, accountID).Scan(&n); err != nil {
			return err
		}
		if n >= MaxCollections {
			return ErrTooMany
		}
		colors := palette[n%len(palette)]
		c = Collection{Name: name, Kids: kids, Colors: colors, Films: []string{}, SharedTo: []string{}, Mine: true}
		return tx.QueryRow(ctx, `INSERT INTO collections (account_id, name, kids, colors) VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
			accountID, name, kids, colors).Scan(&c.ID, &c.CreatedAt)
	})
	return c, err
}

func (s Store) owned(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, accountID, id string) error {
	if !uuidRe.MatchString(id) {
		return ErrNotFound
	}
	var owner string
	err := q.QueryRow(ctx, `SELECT account_id::text FROM collections WHERE id = $1`, id).Scan(&owner)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if owner != accountID {
		return ErrNotOwner
	}
	return nil
}

// UpdateCollection renames a collection or changes its kids flag.
func (s Store) UpdateCollection(ctx context.Context, accountID, id, name string, kids bool) error {
	name, err := cleanName(name)
	if err != nil {
		return err
	}
	if err := s.owned(ctx, s.DB, accountID, id); err != nil {
		return err
	}
	_, err = s.DB.Exec(ctx, `UPDATE collections SET name = $2, kids = $3 WHERE id = $1`, id, name, kids)
	return err
}

// DeleteCollection removes the owner's collection (shares go with it).
func (s Store) DeleteCollection(ctx context.Context, accountID, id string) error {
	if err := s.owned(ctx, s.DB, accountID, id); err != nil {
		return err
	}
	_, err := s.DB.Exec(ctx, `DELETE FROM collections WHERE id = $1`, id)
	return err
}

// SetFilm adds a film to (or takes it off) a collection.
func (s Store) SetFilm(ctx context.Context, accountID, id, showtimeID string, in bool) error {
	if err := s.owned(ctx, s.DB, accountID, id); err != nil {
		return err
	}
	if !in {
		_, err := s.DB.Exec(ctx, `DELETE FROM collection_films WHERE collection_id = $1 AND showtime_id = $2`, id, showtimeID)
		return err
	}
	_, err := s.DB.Exec(ctx, `INSERT INTO collection_films (collection_id, showtime_id)
	  SELECT $1, id FROM showtimes WHERE id = $2 ON CONFLICT DO NOTHING`, id, showtimeID)
	return err
}

// Share lets a friend see the collection, by their account email. It returns their name.
func (s Store) Share(ctx context.Context, accountID, id, email string) (string, error) {
	if err := s.owned(ctx, s.DB, accountID, id); err != nil {
		return "", err
	}
	var friend, name string
	err := s.DB.QueryRow(ctx, `SELECT id::text, name FROM accounts WHERE lower(email) = lower($1)`, strings.TrimSpace(email)).Scan(&friend, &name)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNoFriend
	}
	if err != nil {
		return "", err
	}
	if friend == accountID {
		return "", ErrShareSelf
	}
	_, err = s.DB.Exec(ctx, `INSERT INTO collection_shares (collection_id, account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, id, friend)
	return name, err
}

// Leave removes a collection someone shared with the viewer from their Library.
func (s Store) Leave(ctx context.Context, accountID, id string) error {
	if !uuidRe.MatchString(id) {
		return ErrNotFound
	}
	_, err := s.DB.Exec(ctx, `DELETE FROM collection_shares WHERE collection_id = $1 AND account_id = $2`, id, accountID)
	return err
}
