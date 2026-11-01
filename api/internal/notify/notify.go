// Package notify stores the viewer's notifications (Figma 31:878): premiere reminders, party
// invites, lottery wins, payments, shared collections, gifts and new sign-ins.
package notify

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Categories match the filter chips on the page. Sign-ins only show under All.
var categories = map[string][]string{
	"premieres": {"premiere", "language"},
	"social":    {"party", "reply", "share", "gift", "friend"},
	"payments":  {"payment", "refund", "lottery"},
}

// ReminderLead is how long before a premiere the "starts in 1 hour" reminder appears.
const (
	ReminderLead = time.Hour
	PageSize     = 50
)

var ErrBadInput = errors.New("bad notification")

type Store struct{ DB *pgxpool.Pool }

type Note struct {
	ID        int64      `json:"id"`
	Kind      string     `json:"kind"`
	Title     string     `json:"title"`
	Body      string     `json:"body"`
	Link      string     `json:"link"`
	CreatedAt time.Time  `json:"createdAt"`
	ReadAt    *time.Time `json:"readAt"`
}

// New is one notification to store. Dedupe, when set, makes Add a no-op for a repeat.
type New struct {
	Kind, Title, Body, Link, Dedupe string
}

// Add stores a notification. Producers call it after their own work succeeded, and a failure
// here never undoes that work, so callers may ignore the error.
func (s Store) Add(ctx context.Context, accountID string, n New) error {
	if s.DB == nil {
		return nil
	}
	var dedupe *string
	if n.Dedupe != "" {
		dedupe = &n.Dedupe
	}
	_, err := s.DB.Exec(ctx, `INSERT INTO notifications (account_id, kind, title, body, link, dedupe)
	  VALUES ($1, $2, left($3, 120), left($4, 300), $5, $6) ON CONFLICT (account_id, dedupe) WHERE dedupe IS NOT NULL DO NOTHING`,
		accountID, n.Kind, n.Title, n.Body, n.Link, dedupe)
	return err
}

// AddByEmail notifies whoever owns an email address, if anyone does.
func (s Store) AddByEmail(ctx context.Context, email string, n New) error {
	if s.DB == nil {
		return nil
	}
	var id string
	if err := s.DB.QueryRow(ctx, `SELECT id FROM accounts WHERE lower(email) = lower($1)`, email).Scan(&id); err != nil {
		return nil
	}
	return s.Add(ctx, id, n)
}

// remind adds "starts in 1 hour" notes for paid seats whose premiere is within the hour.
func (s Store) remind(ctx context.Context, accountID string, now time.Time) error {
	_, err := s.DB.Exec(ctx, `INSERT INTO notifications (account_id, kind, title, body, link, dedupe, created_at)
	  SELECT DISTINCT ON (st.id) $1::uuid, 'premiere', st.film || ' starts in 1 hour',
	    'Your room opens 30 minutes before the start. ' || CASE WHEN f.n > 0 THEN f.n || CASE WHEN f.n = 1 THEN ' friend is' ELSE ' friends are' END || ' going.' ELSE 'Your seat is ready.' END,
	    '/room/' || st.id, 'remind:' || st.id, st.starts_at - $3::interval
	  FROM holds h JOIN showtimes st ON st.id = h.showtime_id
	  CROSS JOIN LATERAL (
	    SELECT count(DISTINCT pm2.account_id)::int AS n FROM party_members pm
	    JOIN parties p ON p.id = pm.party_id AND p.showtime_id = st.id
	    JOIN party_members pm2 ON pm2.party_id = p.id AND pm2.account_id <> $1
	    WHERE pm.account_id = $1) f
	  WHERE h.account_id = $1 AND h.status = 'paid' AND st.starts_at > $2::timestamptz AND st.starts_at <= $2::timestamptz + $3::interval
	  ON CONFLICT (account_id, dedupe) WHERE dedupe IS NOT NULL DO NOTHING`,
		accountID, now, ReminderLead.String())
	return err
}

// List returns the newest notifications, optionally for one category.
func (s Store) List(ctx context.Context, accountID, category string, now time.Time) ([]Note, error) {
	kinds, ok := categories[category]
	if category != "" && category != "all" && !ok {
		return nil, ErrBadInput
	}
	if err := s.remind(ctx, accountID, now); err != nil {
		return nil, fmt.Errorf("reminders: %w", err)
	}
	rows, err := s.DB.Query(ctx, `SELECT id, kind, title, body, link, created_at, read_at FROM notifications
	  WHERE account_id = $1 AND ($2::text[] IS NULL OR kind = ANY($2)) ORDER BY created_at DESC, id DESC LIMIT $3`,
		accountID, kinds, PageSize)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Note{}
	for rows.Next() {
		var n Note
		if err := rows.Scan(&n.ID, &n.Kind, &n.Title, &n.Body, &n.Link, &n.CreatedAt, &n.ReadAt); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// Unread counts unread notifications, adding any reminder that is now due.
func (s Store) Unread(ctx context.Context, accountID string, now time.Time) (int, error) {
	if err := s.remind(ctx, accountID, now); err != nil {
		return 0, err
	}
	var n int
	err := s.DB.QueryRow(ctx, `SELECT count(*) FROM notifications WHERE account_id = $1 AND read_at IS NULL`, accountID).Scan(&n)
	return n, err
}

// MarkRead marks one notification, or all of them when id is 0.
func (s Store) MarkRead(ctx context.Context, accountID string, id int64) error {
	_, err := s.DB.Exec(ctx, `UPDATE notifications SET read_at = now() WHERE account_id = $1 AND read_at IS NULL AND ($2 = 0 OR id = $2)`, accountID, id)
	return err
}
