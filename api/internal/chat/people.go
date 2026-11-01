// Package chat runs friends, friend requests, direct messages and groups (Figma 32:798, 95:2163).
package chat

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Limits that keep messaging pleasant.
const (
	MaxRequestsPerDay = 30
	MaxGroupMembers   = 50
	MaxGroups         = 30
	PageSize          = 50
)

var (
	ErrNotFound       = errors.New("not found")
	ErrSelf           = errors.New("you cannot add yourself")
	ErrAlreadyFriends = errors.New("you are already friends")
	ErrBlocked        = errors.New("you cannot message this person")
	ErrTooMany        = errors.New("too many requests today, try again tomorrow")
	ErrNotFriends     = errors.New("you can only message friends; send a friend request first")
	ErrNotMember      = errors.New("you are not in this chat")
	ErrBadInput       = errors.New("bad message")
	ErrPending        = errors.New("a request is already waiting")
)

var reasons = map[string]bool{"harassment": true, "hate": true, "spam": true, "scam": true, "under13": true, "other": true}

type Store struct{ DB *pgxpool.Pool }

// Person is someone shown in search, requests or a chat header.
type Person struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Country   string   `json:"country"`
	Languages []string `json:"languages"`
	Friend    bool     `json:"friend"`
	Requested bool     `json:"requested"` // a request from me is waiting
	Online    bool     `json:"online"`
}

type Request struct {
	ID      string `json:"id"`
	From    Person `json:"from"`
	Note    string `json:"note"`
	Spam    string `json:"spam"`   // "", "ai" or "rules"
	Room    string `json:"room"`   // a film we both had seats for
	Mutual  int    `json:"mutual"` // friends in common
	Created string `json:"createdAt"`
}

func pair(x, y string) (string, string) {
	if x < y {
		return x, y
	}
	return y, x
}

func blockedEither(ctx context.Context, q pgx.Tx, a, b string) (bool, error) {
	var n int
	err := q.QueryRow(ctx, `SELECT count(*) FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)`, a, b).Scan(&n)
	return n > 0, err
}

func areFriends(ctx context.Context, q pgx.Tx, a, b string) (bool, error) {
	x, y := pair(a, b)
	var ok bool
	err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM friends WHERE a = $1 AND b = $2)`, x, y).Scan(&ok)
	return ok, err
}

const personCols = `a.id::text, a.name, coalesce(a.country, ''),
  array_remove(ARRAY[nullif(a.app_language, ''), nullif(CASE WHEN a.audio_language = a.app_language THEN '' ELSE a.audio_language END, '')], NULL)`

// Search finds friends, people met in a room or party, and an exact email match.
// Strangers are never listed by name, so nobody can trawl the member list.
func (s Store) Search(ctx context.Context, me, q string) ([]Person, error) {
	q = strings.TrimSpace(q)
	if len(q) < 2 || len(q) > 80 {
		return []Person{}, nil
	}
	rows, err := s.DB.Query(ctx, `
	  WITH met AS (
	    SELECT DISTINCT h2.account_id AS id FROM holds h1 JOIN holds h2 ON h2.showtime_id = h1.showtime_id AND h2.status = 'paid'
	    WHERE h1.account_id = $1 AND h1.status = 'paid'
	    UNION SELECT DISTINCT pm2.account_id FROM party_members pm1 JOIN party_members pm2 ON pm2.party_id = pm1.party_id WHERE pm1.account_id = $1
	    UNION SELECT b FROM friends WHERE a = $1 UNION SELECT a FROM friends WHERE b = $1
	  )
	  SELECT `+personCols+`,
	    EXISTS (SELECT 1 FROM friends f WHERE (f.a = $1 AND f.b = a.id) OR (f.b = $1 AND f.a = a.id)),
	    EXISTS (SELECT 1 FROM friend_requests r WHERE r.from_id = $1 AND r.to_id = a.id AND r.status = 'pending')
	  FROM accounts a
	  WHERE a.id <> $1
	    AND NOT EXISTS (SELECT 1 FROM blocks bl WHERE (bl.blocker_id = $1 AND bl.blocked_id = a.id) OR (bl.blocker_id = a.id AND bl.blocked_id = $1))
	    AND ((a.id IN (SELECT id FROM met) AND a.name ILIKE '%' || $2 || '%') OR lower(a.email) = lower($2))
	  ORDER BY 6 DESC, a.name LIMIT 20`, me, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Person{}
	for rows.Next() {
		var p Person
		if err := rows.Scan(&p.ID, &p.Name, &p.Country, &p.Languages, &p.Friend, &p.Requested); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// Person returns one account as the viewer may see it.
func (s Store) Person(ctx context.Context, me, id string) (Person, error) {
	var p Person
	err := s.DB.QueryRow(ctx, `SELECT `+personCols+`,
	    EXISTS (SELECT 1 FROM friends f WHERE (f.a = $1 AND f.b = a.id) OR (f.b = $1 AND f.a = a.id))
	  FROM accounts a WHERE a.id = $2`, me, id).Scan(&p.ID, &p.Name, &p.Country, &p.Languages, &p.Friend)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, ErrNotFound
	}
	return p, err
}

// SendRequest asks to be friends. If the other person already asked, it makes us friends.
// It reports whether we are friends now.
func (s Store) SendRequest(ctx context.Context, me, to, note, spam string) (bool, error) {
	note = strings.TrimSpace(note)
	if me == to {
		return false, ErrSelf
	}
	if len([]rune(note)) > 140 || (spam != "" && spam != "ai" && spam != "rules") {
		return false, ErrBadInput
	}
	friends := false
	err := pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM accounts WHERE id = $1)`, to).Scan(&exists); err != nil || !exists {
			if err == nil {
				err = ErrNotFound
			}
			return err
		}
		if b, err := blockedEither(ctx, tx, me, to); err != nil || b {
			if err == nil {
				err = ErrBlocked
			}
			return err
		}
		if f, err := areFriends(ctx, tx, me, to); err != nil || f {
			if err == nil {
				err = ErrAlreadyFriends
			}
			return err
		}
		var back string
		err := tx.QueryRow(ctx, `UPDATE friend_requests SET status = 'accepted', decided_at = now()
		  WHERE from_id = $1 AND to_id = $2 AND status = 'pending' RETURNING id::text`, to, me).Scan(&back)
		if err == nil {
			friends = true
			x, y := pair(me, to)
			_, err = tx.Exec(ctx, `INSERT INTO friends (a, b) VALUES ($1, $2) ON CONFLICT DO NOTHING`, x, y)
			return err
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		var today int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM friend_requests WHERE from_id = $1 AND created_at > now() - interval '1 day'`, me).Scan(&today); err != nil {
			return err
		}
		if today >= MaxRequestsPerDay {
			return ErrTooMany
		}
		tag, err := tx.Exec(ctx, `INSERT INTO friend_requests (from_id, to_id, note, spam) VALUES ($1, $2, $3, $4)
		  ON CONFLICT (from_id, to_id) WHERE status = 'pending' DO NOTHING`, me, to, note, spam)
		if err == nil && tag.RowsAffected() == 0 {
			return ErrPending
		}
		return err
	})
	return friends, err
}

// Requests lists requests waiting for me, newest first, with why we might know each other.
func (s Store) Requests(ctx context.Context, me string) ([]Request, error) {
	rows, err := s.DB.Query(ctx, `
	  SELECT r.id::text, `+personCols+`, r.note, r.spam, to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
	    coalesce((SELECT st.film FROM holds h1 JOIN holds h2 ON h2.showtime_id = h1.showtime_id AND h2.account_id = r.from_id AND h2.status = 'paid'
	      JOIN showtimes st ON st.id = h1.showtime_id WHERE h1.account_id = $1 AND h1.status = 'paid' ORDER BY st.starts_at DESC LIMIT 1), ''),
	    (SELECT count(*)::int FROM (SELECT CASE WHEN a = $1 THEN b ELSE a END AS f FROM friends WHERE a = $1 OR b = $1) mine
	      JOIN (SELECT CASE WHEN a = r.from_id THEN b ELSE a END AS f FROM friends WHERE a = r.from_id OR b = r.from_id) theirs USING (f))
	  FROM friend_requests r JOIN accounts a ON a.id = r.from_id
	  WHERE r.to_id = $1 AND r.status = 'pending'
	    AND NOT EXISTS (SELECT 1 FROM blocks bl WHERE bl.blocker_id = $1 AND bl.blocked_id = r.from_id)
	  ORDER BY (r.spam <> '') , r.created_at DESC LIMIT 100`, me)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Request{}
	for rows.Next() {
		var q Request
		if err := rows.Scan(&q.ID, &q.From.ID, &q.From.Name, &q.From.Country, &q.From.Languages, &q.Note, &q.Spam, &q.Created, &q.Room, &q.Mutual); err != nil {
			return nil, err
		}
		out = append(out, q)
	}
	return out, rows.Err()
}

// Decide answers a request: accept, decline, or report (which also blocks the sender).
// It returns the sender's id.
func (s Store) Decide(ctx context.Context, me, requestID, action, reason string) (string, error) {
	if action != "accept" && action != "decline" && action != "report" {
		return "", ErrBadInput
	}
	if action == "report" && !reasons[reason] {
		reason = "spam"
	}
	var from string
	err := pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		status := map[string]string{"accept": "accepted", "decline": "declined", "report": "reported"}[action]
		err := tx.QueryRow(ctx, `UPDATE friend_requests SET status = $3, decided_at = now()
		  WHERE id::text = $1 AND to_id = $2 AND status = 'pending' RETURNING from_id::text`, requestID, me, status).Scan(&from)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		switch action {
		case "accept":
			x, y := pair(me, from)
			_, err = tx.Exec(ctx, `INSERT INTO friends (a, b) VALUES ($1, $2) ON CONFLICT DO NOTHING`, x, y)
		case "report":
			if _, err = tx.Exec(ctx, `INSERT INTO chat_reports (reporter_id, reported_id, request_id, reason) VALUES ($1, $2, $3::uuid, $4)`, me, from, requestID, reason); err == nil {
				_, err = tx.Exec(ctx, `INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, me, from)
			}
		}
		return err
	})
	return from, err
}

// Friends lists my friends by name.
func (s Store) Friends(ctx context.Context, me string) ([]Person, error) {
	rows, err := s.DB.Query(ctx, `SELECT `+personCols+` FROM friends f JOIN accounts a ON a.id = CASE WHEN f.a = $1 THEN f.b ELSE f.a END
	  WHERE (f.a = $1 OR f.b = $1) ORDER BY a.name LIMIT 500`, me)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Person{}
	for rows.Next() {
		p := Person{Friend: true}
		if err := rows.Scan(&p.ID, &p.Name, &p.Country, &p.Languages); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// FriendIDs is who should hear about my presence.
func (s Store) FriendIDs(ctx context.Context, me string) ([]string, error) {
	rows, err := s.DB.Query(ctx, `SELECT (CASE WHEN a = $1 THEN b ELSE a END)::text FROM friends WHERE a = $1 OR b = $1`, me)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// Unfriend ends a friendship. Old messages stay, but nobody can send new ones.
func (s Store) Unfriend(ctx context.Context, me, other string) error {
	x, y := pair(me, other)
	_, err := s.DB.Exec(ctx, `DELETE FROM friends WHERE a = $1 AND b = $2`, x, y)
	return err
}

// Block stops someone reaching me at all, and ends any friendship.
func (s Store) Block(ctx context.Context, me, other string) error {
	if me == other {
		return ErrSelf
	}
	return pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		x, y := pair(me, other)
		if _, err := tx.Exec(ctx, `DELETE FROM friends WHERE a = $1 AND b = $2`, x, y); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE friend_requests SET status = 'declined', decided_at = now() WHERE status = 'pending' AND ((from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1))`, me, other); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, me, other)
		return err
	})
}
