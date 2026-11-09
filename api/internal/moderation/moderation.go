// Package moderation is the automatic check on public chat and community posts. The web app's
// worker takes each new world-chat message, post and comment from Queue, asks Claude whether it
// breaks the rules, and sends back what it found with Flag. The clearest abuse is hidden at once;
// everything flagged waits on the Safety and trust page until a person keeps it hidden or puts it
// back. Private messages and party chat are not read: they rely on reports and blocking.
package moderation

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct{ DB *pgxpool.Pool }

var (
	ErrBadInput = errors.New("bad moderation input")
	ErrNotFound = errors.New("no such flag")
)

const (
	// HideAt: a flag this sure (in percent) hides the item for everyone straight away.
	HideAt = 85
	// FlagAt: below this the item is left alone and not listed.
	FlagAt = 60
	batch  = 80
)

var sources = map[string]bool{"room": true, "post": true, "comment": true}

// Labels the check can give. Self-harm is never hidden automatically: a person looks at it.
var labels = map[string]bool{"abusive": true, "hateful": true, "sexual": true, "threat": true, "selfharm": true, "spam": true, "scam": true, "piracy": true}

type Item struct {
	Source string `json:"source"`
	ID     int64  `json:"id"`
	Place  string `json:"place"`
	Body   string `json:"body"`
}

// Queue returns new items to check, oldest first, and the highest id of each source read.
func (st Store) Queue(ctx context.Context) ([]Item, map[string]int64, error) {
	items := []Item{}
	upto := map[string]int64{}
	rows, err := st.DB.Query(ctx, `
	  SELECT 'room', m.id, coalesce(sh.film, ''), m.body FROM room_messages m
	    JOIN moderation_cursor c ON c.source = 'room' LEFT JOIN showtimes sh ON sh.id = m.showtime_id
	    WHERE m.id > c.last_id AND m.party_id IS NULL AND m.kind = 'text' AND NOT m.hidden ORDER BY m.id LIMIT $1`, batch)
	if err != nil {
		return nil, nil, err
	}
	if err := collect(rows, &items); err != nil {
		return nil, nil, err
	}
	rows, err = st.DB.Query(ctx, `
	  SELECT 'post', p.id, coalesce(cm.name, ''), p.body || CASE WHEN p.kind = 'poll' THEN E'\n' || coalesce((SELECT string_agg(label, E'\n' ORDER BY idx) FROM poll_options WHERE post_id = p.id), '') ELSE '' END
	    FROM posts p JOIN moderation_cursor c ON c.source = 'post' LEFT JOIN communities cm ON cm.id = p.community_id
	    WHERE p.id > c.last_id AND p.deleted_at IS NULL AND p.body <> '' ORDER BY p.id LIMIT $1`, batch)
	if err != nil {
		return nil, nil, err
	}
	if err := collect(rows, &items); err != nil {
		return nil, nil, err
	}
	rows, err = st.DB.Query(ctx, `
	  SELECT 'comment', k.id, coalesce(cm.name, ''), k.body FROM post_comments k
	    JOIN moderation_cursor c ON c.source = 'comment' JOIN posts p ON p.id = k.post_id LEFT JOIN communities cm ON cm.id = p.community_id
	    WHERE k.id > c.last_id AND k.deleted_at IS NULL ORDER BY k.id LIMIT $1`, batch)
	if err != nil {
		return nil, nil, err
	}
	if err := collect(rows, &items); err != nil {
		return nil, nil, err
	}
	for _, it := range items {
		if it.ID > upto[it.Source] {
			upto[it.Source] = it.ID
		}
	}
	return items, upto, nil
}

func collect(rows pgx.Rows, into *[]Item) error {
	got, err := pgx.CollectRows(rows, pgx.RowToStructByPos[Item])
	*into = append(*into, got...)
	return err
}

type Verdict struct {
	Source string `json:"source"`
	ID     int64  `json:"id"`
	Label  string `json:"label"`
	Pct    int    `json:"pct"`
}

// Hidden is a world-chat message hidden by Flag, so the watch room can take it off screens.
type Hidden struct {
	Showtime string
	ID       int64
}

// Flag stores the check's findings and moves each source's cursor to `upto`. Findings below
// FlagAt are ignored. It returns the world-chat messages it hid.
func (st Store) Flag(ctx context.Context, verdicts []Verdict, upto map[string]int64) ([]Hidden, error) {
	for src := range upto {
		if !sources[src] {
			return nil, ErrBadInput
		}
	}
	hidden := []Hidden{}
	tx, err := st.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	for _, v := range verdicts {
		if !sources[v.Source] || !labels[v.Label] || v.Pct < 0 || v.Pct > 100 {
			return nil, ErrBadInput
		}
		if v.Pct < FlagAt {
			continue
		}
		hide := v.Pct >= HideAt && v.Label != "selfharm"
		var account *string
		var place, body, showtime string
		var q string
		switch v.Source {
		case "room":
			q = `SELECT m.account_id::text, coalesce(sh.film, ''), m.body, m.showtime_id FROM room_messages m LEFT JOIN showtimes sh ON sh.id = m.showtime_id WHERE m.id = $1`
		case "post":
			q = `SELECT p.author_id::text, coalesce(cm.name, ''), p.body, '' FROM posts p LEFT JOIN communities cm ON cm.id = p.community_id WHERE p.id = $1 AND p.deleted_at IS NULL`
		case "comment":
			q = `SELECT k.author_id::text, coalesce(cm.name, ''), k.body, '' FROM post_comments k JOIN posts p ON p.id = k.post_id LEFT JOIN communities cm ON cm.id = p.community_id WHERE k.id = $1 AND k.deleted_at IS NULL`
		}
		if err := tx.QueryRow(ctx, q, v.ID).Scan(&account, &place, &body, &showtime); errors.Is(err, pgx.ErrNoRows) {
			continue // deleted since it was read
		} else if err != nil {
			return nil, err
		}
		tag, err := tx.Exec(ctx, `INSERT INTO auto_flags (source, item_id, account_id, place, body, label, pct, hidden)
		  VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`, v.Source, v.ID, account, place, body, v.Label, v.Pct, hide)
		if err != nil {
			return nil, err
		}
		if tag.RowsAffected() == 0 || !hide {
			continue
		}
		if err := setHidden(ctx, tx, v.Source, v.ID, true); err != nil {
			return nil, err
		}
		if v.Source == "room" {
			hidden = append(hidden, Hidden{Showtime: showtime, ID: v.ID})
		}
	}
	for src, id := range upto {
		if _, err := tx.Exec(ctx, `UPDATE moderation_cursor SET last_id = greatest(last_id, $2) WHERE source = $1`, src, id); err != nil {
			return nil, err
		}
	}
	return hidden, tx.Commit(ctx)
}

func setHidden(ctx context.Context, tx pgx.Tx, source string, id int64, hide bool) error {
	var err error
	switch source {
	case "room":
		_, err = tx.Exec(ctx, `UPDATE room_messages SET hidden = $2 WHERE id = $1`, id, hide)
	case "post":
		if hide {
			_, err = tx.Exec(ctx, `UPDATE posts SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, id)
		} else {
			_, err = tx.Exec(ctx, `UPDATE posts SET deleted_at = NULL WHERE id = $1`, id)
		}
	case "comment":
		var post int64
		if hide {
			err = tx.QueryRow(ctx, `UPDATE post_comments SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING post_id`, id).Scan(&post)
			if err == nil {
				_, err = tx.Exec(ctx, `UPDATE posts SET comments = greatest(comments - 1, 0) WHERE id = $1`, post)
			}
		} else {
			err = tx.QueryRow(ctx, `UPDATE post_comments SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL RETURNING post_id`, id).Scan(&post)
			if err == nil {
				_, err = tx.Exec(ctx, `UPDATE posts SET comments = comments + 1 WHERE id = $1`, post)
			}
		}
		if errors.Is(err, pgx.ErrNoRows) {
			err = nil
		}
	}
	return err
}

type Flagged struct {
	Source string    `json:"source"`
	ID     int64     `json:"id"`
	Place  string    `json:"place"`
	Body   string    `json:"body"`
	Label  string    `json:"label"`
	Pct    int       `json:"pct"`
	Hidden bool      `json:"hidden"`
	At     time.Time `json:"at"`
}

// Open lists flags waiting for a person, newest first, with how many were flagged today.
func (st Store) Open(ctx context.Context, since time.Time) ([]Flagged, int, error) {
	rows, err := st.DB.Query(ctx, `SELECT source, item_id, place, body, label, pct, hidden, created_at
	  FROM auto_flags WHERE status = 'open' ORDER BY hidden DESC, created_at DESC LIMIT 30`)
	if err != nil {
		return nil, 0, err
	}
	out, err := pgx.CollectRows(rows, pgx.RowToStructByPos[Flagged])
	if err != nil {
		return nil, 0, err
	}
	var today int
	err = st.DB.QueryRow(ctx, `SELECT count(*) FROM auto_flags WHERE created_at >= $1`, since).Scan(&today)
	return out, today, err
}

// Review settles a flag: hide the item (or keep it hidden), or put it back. It returns the
// showtime of a world-chat message that is hidden now, so screens can drop it.
func (st Store) Review(ctx context.Context, source string, id int64, hide bool, by string) (string, error) {
	if !sources[source] {
		return "", ErrBadInput
	}
	tx, err := st.DB.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	status := "restored"
	if hide {
		status = "upheld"
	}
	var was bool
	err = tx.QueryRow(ctx, `UPDATE auto_flags SET status = $3, hidden = $4, reviewed_by = $5, reviewed_at = now()
	  WHERE source = $1 AND item_id = $2 AND status = 'open' RETURNING (SELECT hidden FROM auto_flags WHERE source = $1 AND item_id = $2)`,
		source, id, status, hide, strings.ToLower(by)).Scan(&was)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if was != hide {
		if err := setHidden(ctx, tx, source, id, hide); err != nil {
			return "", err
		}
	}
	showtime := ""
	if hide && source == "room" {
		if err := tx.QueryRow(ctx, `SELECT showtime_id FROM room_messages WHERE id = $1`, id).Scan(&showtime); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return "", err
		}
	}
	return showtime, tx.Commit(ctx)
}
