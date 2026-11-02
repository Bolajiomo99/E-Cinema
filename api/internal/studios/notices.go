package studios

import (
	"context"
	"errors"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
)

// ---- Notifications (Figma 99:552) ----
// Notices are read from what already happened (leaks, dubs, uploads, payouts, reviews, team),
// so nothing has to remember to write them. The page words them; Type says which kind it is.

type Notice struct {
	ID       string    `json:"id"`
	Type     string    `json:"type"`
	Group    string    `json:"group"` // piracy, films, money, reviews, team
	Action   bool      `json:"action"`
	At       time.Time `json:"at"`
	Film     string    `json:"film"`
	Lang     string    `json:"lang"`
	Text     string    `json:"text"`
	Num      int64     `json:"num"`
	Currency string    `json:"currency"`
	Ref      string    `json:"ref"`
}

type Notices struct {
	Notices []Notice   `json:"notices"`
	SeenAt  *time.Time `json:"seenAt"`
	Unread  int        `json:"unread"`
	Action  int        `json:"action"`
}

const noticeDays = 60

func (st Store) Notices(ctx context.Context, acct, email string, now time.Time) (Notices, error) {
	s, err := st.verified(ctx, acct, email, false)
	if err != nil {
		return Notices{}, err
	}
	since := now.Add(-noticeDays * 24 * time.Hour)
	out := []Notice{}
	add := func(q string, args []any, scan func(r pgx.Row) (Notice, error)) error {
		rows, err := st.DB.Query(ctx, q, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			n, err := scan(rows)
			if err != nil {
				return err
			}
			out = append(out, n)
		}
		return rows.Err()
	}
	// Leaks: open ones need a decision; closed ones say how they ended.
	if err := add(`SELECT l.id::text, coalesce(t.film, ''), l.place, l.kind, l.status, l.ban, greatest(l.created_at, coalesce(l.taken_down_at, l.created_at), coalesce(l.ban_at, l.created_at))
	  FROM studio_leaks l LEFT JOIN showtimes t ON t.id = l.showtime_id WHERE l.studio = $1 AND greatest(l.created_at, coalesce(l.taken_down_at, l.created_at), coalesce(l.ban_at, l.created_at)) > $2`,
		[]any{s.Name, since}, func(r pgx.Row) (Notice, error) {
			var n Notice
			var kind, status, ban string
			err := r.Scan(&n.Ref, &n.Film, &n.Text, &kind, &status, &ban, &n.At)
			n.Group, n.Lang = "piracy", kind
			switch {
			case ban == "banned":
				n.Type = "leak_banned"
			case status == "taken_down":
				n.Type = "leak_down"
			case status == "open":
				n.Type, n.Action = "leak_open", true
			default:
				n.Type = "leak_noted"
			}
			n.ID = "leak:" + n.Ref + ":" + n.Type
			return n, err
		}); err != nil {
		return Notices{}, err
	}
	// Dubs waiting for review, failed or approved.
	if err := add(`SELECT d.upload::text, u.title, d.lang, d.status, d.updated_at FROM studio_dubs d JOIN studio_uploads u ON u.id = d.upload
	  WHERE u.studio = $1 AND d.status IN ('review', 'failed', 'approved') AND d.updated_at > $2`, []any{s.Name, since}, func(r pgx.Row) (Notice, error) {
		var n Notice
		var status string
		err := r.Scan(&n.Ref, &n.Film, &n.Lang, &status, &n.At)
		n.Group, n.Type, n.Action = "films", "dub_"+status, status != "approved"
		n.ID = "dub:" + n.Ref + ":" + n.Lang + ":" + status
		return n, err
	}); err != nil {
		return Notices{}, err
	}
	// Uploads that failed.
	if err := add(`SELECT f.id::text, u.id::text, u.title, f.name, f.updated_at FROM studio_upload_files f JOIN studio_uploads u ON u.id = f.upload_id
	  WHERE u.studio = $1 AND f.status = 'failed' AND f.updated_at > $2`, []any{s.Name, since}, func(r pgx.Row) (Notice, error) {
		var n Notice
		var id string
		err := r.Scan(&id, &n.Ref, &n.Film, &n.Text, &n.At)
		n.Group, n.Type, n.Action, n.ID = "films", "upload_failed", true, "file:"+id
		return n, err
	}); err != nil {
		return Notices{}, err
	}
	// Premieres put on sale.
	if err := add(`SELECT p.showtime_id, u.title, p.coming_soon, p.published_at FROM studio_premieres p JOIN studio_uploads u ON u.id = p.upload
	  WHERE u.studio = $1 AND p.published_at > $2 AND p.showtime_id IS NOT NULL`, []any{s.Name, since}, func(r pgx.Row) (Notice, error) {
		var n Notice
		var soon bool
		err := r.Scan(&n.Ref, &n.Film, &soon, &n.At)
		n.Group, n.Type, n.ID = "films", "on_sale", "sale:"+n.Ref
		if soon {
			n.Type = "on_sale_soon"
		}
		return n, err
	}); err != nil {
		return Notices{}, err
	}
	// Money is only for the roles that may see it.
	if can(s.Role, "money") {
		if err := add(`SELECT p.showtime_id, t.film, p.status, p.studio_cents, p.currency, p.updated_at FROM studio_payouts p JOIN showtimes t ON t.id = p.showtime_id
		  WHERE p.studio = $1 AND p.status IN ('sent', 'failed') AND p.updated_at > $2`, []any{s.Name, since}, func(r pgx.Row) (Notice, error) {
			var n Notice
			var status string
			err := r.Scan(&n.Ref, &n.Film, &status, &n.Num, &n.Currency, &n.At)
			n.Currency = trimCurrency(n.Currency)
			n.Group, n.Type, n.Action, n.ID = "money", "payout_"+status, status == "failed", "payout:"+n.Ref+":"+status
			return n, err
		}); err != nil {
			return Notices{}, err
		}
	}
	// Reviews of the studio's films.
	if err := add(`SELECT r.account_id::text, r.showtime_id, t.film, r.stars, r.body, r.created_at FROM reviews r JOIN showtimes t ON t.id = r.showtime_id
	  WHERE t.studio = $1 AND NOT r.hidden AND r.created_at > $2 ORDER BY r.created_at DESC LIMIT 30`, []any{s.Name, since}, func(r pgx.Row) (Notice, error) {
		var n Notice
		var who string
		err := r.Scan(&who, &n.Ref, &n.Film, &n.Num, &n.Text, &n.At)
		n.Group, n.Type, n.ID = "reviews", "review", "review:"+who+":"+n.Ref
		return n, err
	}); err != nil {
		return Notices{}, err
	}
	// Team: people added, with the name they gave once they joined.
	if err := add(`SELECT m.email, coalesce(a.name, ''), m.role, m.added_at FROM studio_members m LEFT JOIN accounts a ON a.id = m.account_id
	  WHERE m.studio = $1 AND m.added_at > $2 AND m.role <> 'owner'`, []any{s.Name, since}, func(r pgx.Row) (Notice, error) {
		var n Notice
		var mail, name string
		err := r.Scan(&mail, &name, &n.Lang, &n.At)
		n.Text = name
		if n.Text == "" {
			n.Text = mail
		}
		n.Group, n.Type, n.ID = "team", "member_added", "member:"+mail
		return n, err
	}); err != nil {
		return Notices{}, err
	}

	sort.Slice(out, func(i, j int) bool { return out[i].At.After(out[j].At) })
	if len(out) > 100 {
		out = out[:100]
	}
	res := Notices{Notices: out}
	var seen time.Time
	err = st.DB.QueryRow(ctx, `SELECT seen_at FROM studio_notice_reads WHERE studio = $1 AND account_id = $2`, s.Name, acct).Scan(&seen)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return Notices{}, err
	}
	if err == nil {
		res.SeenAt = &seen
	}
	for _, n := range out {
		if n.Action {
			res.Action++
		}
		if res.SeenAt == nil || n.At.After(seen) {
			res.Unread++
		}
	}
	return res, nil
}

// SeeNotices marks every notice so far as read for this member.
func (st Store) SeeNotices(ctx context.Context, acct, email string, now time.Time) error {
	s, err := st.verified(ctx, acct, email, false)
	if err != nil {
		return err
	}
	_, err = st.DB.Exec(ctx, `INSERT INTO studio_notice_reads (studio, account_id, seen_at) VALUES ($1, $2, $3)
	  ON CONFLICT (studio, account_id) DO UPDATE SET seen_at = $3`, s.Name, acct, now)
	return err
}

func trimCurrency(c string) string {
	if len(c) > 3 {
		return c[:3]
	}
	return c
}
