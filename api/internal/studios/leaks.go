package studios

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// ---- Piracy protection (Figma 39:578) ----
// A studio reports where its film turned up. If the viewer code burned into the picture is
// readable, we match it to the ticket holder who streamed it. Studios see the code and the
// country, never the person. Closing the account is E-Cinema staff's call.

var ErrNoLeak = errors.New("no such leak report")

type Leak struct {
	ID          string     `json:"id"`
	ShowtimeID  string     `json:"showtimeId"`
	Film        string     `json:"film"`
	Kind        string     `json:"kind"`
	Place       string     `json:"place"`
	Link        string     `json:"link"`
	What        string     `json:"what"`
	Code        string     `json:"code"`
	Traced      bool       `json:"traced"`
	Country     string     `json:"country"`
	Status      string     `json:"status"`
	Ban         string     `json:"ban"`
	Notice      string     `json:"notice"`
	CreatedAt   time.Time  `json:"createdAt"`
	SentAt      *time.Time `json:"sentAt"`
	TakenDownAt *time.Time `json:"takenDownAt"`
}

type LeakStats struct {
	Found30     int     `json:"found30"`
	FoundPrev30 int     `json:"foundPrev30"`
	TakenDown   int     `json:"takenDown"`
	ToTakeDown  int     `json:"toTakeDown"`
	MedianHours float64 `json:"medianHours"`
	Banned      int     `json:"banned"`
	Traced      int     `json:"traced"`
}

type LeakInput struct {
	ShowtimeID string `json:"showtimeId"`
	Kind       string `json:"kind"`
	Place      string `json:"place"`
	Link       string `json:"link"`
	What       string `json:"what"`
	Code       string `json:"code"`
}

const leakCols = `l.id, coalesce(l.showtime_id, ''), coalesce(s.film, ''), l.kind, l.place, l.link, l.what, l.code, l.account_id IS NOT NULL,
  coalesce(a.country, ''), l.status, l.ban, l.notice, l.created_at, l.sent_at, l.taken_down_at`

func scanLeak(r pgx.Row) (Leak, error) {
	var l Leak
	err := r.Scan(&l.ID, &l.ShowtimeID, &l.Film, &l.Kind, &l.Place, &l.Link, &l.What, &l.Code, &l.Traced, &l.Country, &l.Status, &l.Ban, &l.Notice, &l.CreatedAt, &l.SentAt, &l.TakenDownAt)
	return l, err
}

const leakFrom = ` FROM studio_leaks l LEFT JOIN showtimes s ON s.id = l.showtime_id LEFT JOIN accounts a ON a.id = l.account_id`

func (st Store) Leaks(ctx context.Context, acct, email string, now time.Time) ([]Leak, LeakStats, error) {
	var stats LeakStats
	s, err := st.verified(ctx, acct, email, false)
	if err != nil {
		return nil, stats, err
	}
	rows, err := st.DB.Query(ctx, `SELECT `+leakCols+leakFrom+` WHERE l.studio = $1 ORDER BY l.status = 'open' DESC, l.created_at DESC LIMIT 100`, s.Name)
	if err != nil {
		return nil, stats, err
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Leak, error) { return scanLeak(r) })
	if err != nil {
		return nil, stats, err
	}
	err = st.DB.QueryRow(ctx, `SELECT count(*) FILTER (WHERE created_at >= $2::timestamptz - interval '30 days'),
	    count(*) FILTER (WHERE created_at >= $2::timestamptz - interval '60 days' AND created_at < $2::timestamptz - interval '30 days'),
	    count(*) FILTER (WHERE status = 'taken_down'), count(*) FILTER (WHERE status <> 'allowed'),
	    coalesce(extract(epoch FROM percentile_cont(0.5) WITHIN GROUP (ORDER BY taken_down_at - created_at)) / 3600, 0),
	    count(DISTINCT account_id) FILTER (WHERE ban = 'banned'), count(*) FILTER (WHERE account_id IS NOT NULL)
	  FROM studio_leaks WHERE studio = $1`, s.Name, now).Scan(&stats.Found30, &stats.FoundPrev30, &stats.TakenDown, &stats.ToTakeDown, &stats.MedianHours, &stats.Banned, &stats.Traced)
	return list, stats, err
}

var leakKinds = map[string]bool{"clip": true, "full": true, "screenshot": true, "other": true}
var leakPlaces = map[string]bool{"website": true, "telegram": true, "tiktok": true, "youtube": true, "x": true, "instagram": true, "facebook": true, "whatsapp": true, "other": true}

// ReportLeak records a leak. codeOf turns an account into its viewer code, so a code read off
// the picture can be matched to someone who held a seat for one of this studio's screenings.
func (st Store) ReportLeak(ctx context.Context, acct, email string, in LeakInput, codeOf func(string) string) (Leak, error) {
	s, err := st.verified(ctx, acct, email, true)
	if err != nil {
		return Leak{}, err
	}
	in.Link = strings.TrimSpace(in.Link)
	in.What = strings.TrimSpace(in.What)
	in.Code = strings.ToUpper(strings.TrimSpace(in.Code))
	if len(in.Code) == 7 && !strings.Contains(in.Code, "-") {
		in.Code = in.Code[:2] + "-" + in.Code[2:]
	}
	u, perr := url.Parse(in.Link)
	if !leakKinds[in.Kind] || !leakPlaces[in.Place] || perr != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || len(in.Link) > 500 || len(in.What) > 200 {
		return Leak{}, ErrBadInput
	}
	var showtime *string
	if in.ShowtimeID != "" {
		var ok bool
		if err := st.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM showtimes WHERE id = $1 AND studio = $2)`, in.ShowtimeID, s.Name).Scan(&ok); err != nil {
			return Leak{}, err
		}
		if !ok {
			return Leak{}, ErrBadInput
		}
		showtime = &in.ShowtimeID
	}
	var traced *string
	if in.Code != "" {
		if !leakCodeRe(in.Code) {
			return Leak{}, ErrBadInput
		}
		q := `SELECT DISTINCT h.account_id FROM holds h JOIN showtimes s ON s.id = h.showtime_id
		  WHERE s.studio = $1 AND h.status IN ('paid', 'refunded') AND h.account_id IS NOT NULL AND ($2 = '' OR s.id = $2)`
		rows, err := st.DB.Query(ctx, q, s.Name, in.ShowtimeID)
		if err != nil {
			return Leak{}, err
		}
		ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return Leak{}, err
		}
		for _, id := range ids {
			if codeOf(id) == in.Code {
				traced = &id
				break
			}
		}
	}
	var id string
	err = st.DB.QueryRow(ctx, `INSERT INTO studio_leaks (studio, showtime_id, kind, place, link, what, code, account_id, reported_by)
	  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`, s.Name, showtime, in.Kind, in.Place, in.Link, in.What, in.Code, traced, acct).Scan(&id)
	if err != nil {
		return Leak{}, fmt.Errorf("report leak: %w", err)
	}
	return st.leak(ctx, s.Name, id)
}

func leakCodeRe(c string) bool {
	if len(c) != 8 || c[2] != '-' {
		return false
	}
	for i, r := range c {
		if i == 2 {
			continue
		}
		if !strings.ContainsRune("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", r) {
			return false
		}
	}
	return true
}

func (st Store) leak(ctx context.Context, studio, id string) (Leak, error) {
	if !uuidRe.MatchString(id) {
		return Leak{}, ErrNoLeak
	}
	l, err := scanLeak(st.DB.QueryRow(ctx, `SELECT `+leakCols+leakFrom+` WHERE l.studio = $1 AND l.id = $2`, studio, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return l, ErrNoLeak
	}
	return l, err
}

// LeakUpdate moves a report along: a takedown notice drafted or sent, the copy gone, or the
// use allowed (a poster, a short review clip). Ban asks E-Cinema to close the traced account.
type LeakUpdate struct {
	Status *string `json:"status"`
	Notice *string `json:"notice"`
	Ban    bool    `json:"ban"`
}

func (st Store) UpdateLeak(ctx context.Context, acct, email, id string, u LeakUpdate) (Leak, error) {
	s, err := st.verified(ctx, acct, email, true)
	if err != nil {
		return Leak{}, err
	}
	l, err := st.leak(ctx, s.Name, id)
	if err != nil {
		return l, err
	}
	if u.Notice != nil {
		if len(*u.Notice) > 6000 {
			return l, ErrBadInput
		}
		if _, err := st.DB.Exec(ctx, `UPDATE studio_leaks SET notice = $2 WHERE id = $1`, id, strings.TrimSpace(*u.Notice)); err != nil {
			return l, err
		}
	}
	if u.Status != nil {
		switch *u.Status {
		case "open", "takedown_sent", "taken_down", "allowed":
		default:
			return l, ErrBadInput
		}
		if _, err := st.DB.Exec(ctx, `UPDATE studio_leaks SET status = $2,
		    sent_at = CASE WHEN $2 IN ('takedown_sent', 'taken_down') THEN coalesce(sent_at, now()) ELSE sent_at END,
		    taken_down_at = CASE WHEN $2 = 'taken_down' THEN coalesce(taken_down_at, now()) WHEN $2 = 'open' THEN NULL ELSE taken_down_at END
		  WHERE id = $1`, id, *u.Status); err != nil {
			return l, err
		}
	}
	if u.Ban {
		if !l.Traced || l.Ban != "" {
			return l, ErrBadInput
		}
		if _, err := st.DB.Exec(ctx, `UPDATE studio_leaks SET ban = 'requested' WHERE id = $1`, id); err != nil {
			return l, err
		}
	}
	return st.leak(ctx, s.Name, id)
}

// BanRequest is a studio asking E-Cinema staff to close the account a leak traced to.
type BanRequest struct {
	Leak
	Studio    string `json:"studio"`
	AccountID string `json:"accountId"`
	Email     string `json:"email"`
	Name      string `json:"name"`
	Banned    bool   `json:"banned"`
}

func (st Store) BanRequests(ctx context.Context) ([]BanRequest, error) {
	rows, err := st.DB.Query(ctx, `SELECT `+leakCols+`, l.studio, a.id, a.email, a.name, a.banned_at IS NOT NULL`+leakFrom+`
	  WHERE l.ban = 'requested' AND a.id IS NOT NULL ORDER BY l.created_at LIMIT 100`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (BanRequest, error) {
		var b BanRequest
		l := &b.Leak
		err := r.Scan(&l.ID, &l.ShowtimeID, &l.Film, &l.Kind, &l.Place, &l.Link, &l.What, &l.Code, &l.Traced, &l.Country, &l.Status, &l.Ban, &l.Notice, &l.CreatedAt, &l.SentAt, &l.TakenDownAt,
			&b.Studio, &b.AccountID, &b.Email, &b.Name, &b.Banned)
		return b, err
	})
}

// DecideBan settles a ban request; ban does the closing (accounts.Store.Ban) when staff agree.
func (st Store) DecideBan(ctx context.Context, id string, approve bool, ban func(accountID, reason string) error) error {
	if !uuidRe.MatchString(id) {
		return ErrNoLeak
	}
	var acct, studio, film, link string
	err := st.DB.QueryRow(ctx, `SELECT l.account_id, l.studio, coalesce(s.film, ''), l.link FROM studio_leaks l LEFT JOIN showtimes s ON s.id = l.showtime_id
	  WHERE l.id = $1 AND l.ban = 'requested' AND l.account_id IS NOT NULL`, id).Scan(&acct, &studio, &film, &link)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNoLeak
	}
	if err != nil {
		return err
	}
	if approve {
		if film == "" {
			film = "a film"
		}
		if err := ban(acct, fmt.Sprintf("Shared %s by %s without permission: %s", film, studio, link)); err != nil {
			return err
		}
	}
	decision := "declined"
	if approve {
		decision = "banned"
	}
	// One decision covers every report traced to the same account.
	_, err = st.DB.Exec(ctx, `UPDATE studio_leaks SET ban = $2, ban_at = now() WHERE account_id = $1 AND ban = 'requested'`, acct, decision)
	return err
}
