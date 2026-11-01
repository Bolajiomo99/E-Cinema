package community

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// Page is the public profile (Figma 32:1060). Numbers come from what the person really did:
// premieres are live screenings they watched for at least ten minutes, countries chatted are
// the home countries of people they swapped messages with in chats and watch rooms.
type Page struct {
	Author
	Username     string    `json:"username"`
	City         string    `json:"city"`
	Interests    string    `json:"interests"`
	Spoken       []string  `json:"spoken"`
	Plan         string    `json:"plan"`
	Verified     bool      `json:"verified"`
	Me           bool      `json:"me"`
	Following    bool      `json:"following"`
	Followers    int       `json:"followers"`
	Follows      int       `json:"follows"`
	Posts        int       `json:"posts"`
	Premieres    int       `json:"premieres"`
	Countries    int       `json:"countries"`
	Reviews      int       `json:"reviews"`
	ShowsReviews bool      `json:"showsReviews"`
	JoinedAt     time.Time `json:"joinedAt"`
}

const watchedSQL = `SELECT showtime_id FROM watch_beats WHERE account_id = $1 AND mode = 'room' GROUP BY showtime_id HAVING sum(seconds) >= 600`

// ProfilePage finds a person by id or username. Blocked pairs cannot see each other.
func (s Store) ProfilePage(ctx context.Context, me, who string) (Page, error) {
	var p Page
	err := s.DB.QueryRow(ctx, `SELECT a.id::text, a.name, coalesce(a.country, ''), coalesce(a.username, ''), coalesce(a.city, ''),
	    coalesce(a.interests, ''), a.spoken, a.plan, a.face_verified_at IS NOT NULL AND a.id_verified_at IS NOT NULL,
	    a.id = $1::uuid, EXISTS (SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = a.id),
	    (SELECT count(*)::int FROM follows WHERE followee_id = a.id), (SELECT count(*)::int FROM follows WHERE follower_id = a.id),
	    (SELECT count(*)::int FROM posts WHERE author_id = a.id AND deleted_at IS NULL),
	    (SELECT count(*)::int FROM reviews WHERE account_id = a.id AND NOT hidden),
	    coalesce((a.prefs->>'showReviews')::boolean, true), a.created_at
	  FROM accounts a WHERE (a.id::text = $2 OR a.username = lower($2)) AND a.delete_after IS NULL
	    AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = a.id) OR (b.blocker_id = a.id AND b.blocked_id = $1))`, me, who).
		Scan(&p.ID, &p.Name, &p.Country, &p.Username, &p.City, &p.Interests, &p.Spoken, &p.Plan, &p.Verified, &p.Me, &p.Following,
			&p.Followers, &p.Follows, &p.Posts, &p.Reviews, &p.ShowsReviews, &p.JoinedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, ErrNotFound
	}
	if err != nil {
		return p, err
	}
	if err := s.DB.QueryRow(ctx, `SELECT count(*)::int FROM (`+watchedSQL+`) w`, p.ID).Scan(&p.Premieres); err != nil {
		return p, err
	}
	err = s.DB.QueryRow(ctx, `SELECT count(DISTINCT o.country)::int FROM (
	    SELECT m2.sender_id AS other FROM messages m1 JOIN messages m2 ON m2.conversation_id = m1.conversation_id AND m2.sender_id <> m1.sender_id WHERE m1.sender_id = $1
	    UNION SELECT r2.account_id FROM room_messages r1 JOIN room_messages r2 ON r2.showtime_id = r1.showtime_id AND r2.account_id <> r1.account_id WHERE r1.account_id = $1
	  ) x JOIN accounts o ON o.id = x.other WHERE o.country IS NOT NULL`, p.ID).Scan(&p.Countries)
	if !p.Me && !p.ShowsReviews {
		p.Reviews = 0
	}
	return p, err
}

// ProfileChange is what "Edit profile" sets. Empty strings clear a field.
type ProfileChange struct {
	City      string   `json:"city"`
	Interests string   `json:"interests"`
	Spoken    []string `json:"spoken"`
}

func (s Store) EditProfile(ctx context.Context, me string, c ProfileChange) error {
	c.City, c.Interests = strings.TrimSpace(c.City), strings.TrimSpace(c.Interests)
	if utf8.RuneCountInString(c.City) > 40 || utf8.RuneCountInString(c.Interests) > 80 || len(c.Spoken) > 6 {
		return ErrBadInput
	}
	spoken := make([]string, 0, len(c.Spoken))
	for _, l := range c.Spoken {
		l = strings.TrimSpace(l)
		if l == "" || utf8.RuneCountInString(l) > 24 {
			return ErrBadInput
		}
		dup := false
		for _, x := range spoken {
			dup = dup || strings.EqualFold(x, l)
		}
		if !dup {
			spoken = append(spoken, l)
		}
	}
	_, err := s.DB.Exec(ctx, `UPDATE accounts SET city = nullif($2, ''), interests = nullif($3, ''), spoken = $4 WHERE id = $1`, me, c.City, c.Interests, spoken)
	return err
}

// Watched is one live premiere someone sat through.
type Watched struct {
	ShowtimeID string    `json:"showtimeId"`
	Film       string    `json:"film"`
	StartsAt   time.Time `json:"startsAt"`
	Minutes    int       `json:"minutes"`
	Stars      int       `json:"stars"`
}

func (s Store) WatchedList(ctx context.Context, id string) ([]Watched, error) {
	rows, err := s.DB.Query(ctx, `SELECT s.id, s.film, s.starts_at, (sum(w.seconds) / 60)::int, coalesce(max(r.stars), 0)
	  FROM watch_beats w JOIN showtimes s ON s.id = w.showtime_id
	  LEFT JOIN reviews r ON r.account_id = w.account_id AND r.showtime_id = s.id AND NOT r.hidden
	  WHERE w.account_id = $1 AND w.mode = 'room' GROUP BY s.id HAVING sum(w.seconds) >= 600 ORDER BY s.starts_at DESC LIMIT 200`, id)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Watched, error) {
		var x Watched
		return x, r.Scan(&x.ShowtimeID, &x.Film, &x.StartsAt, &x.Minutes, &x.Stars)
	})
}

// ProfileReview is one review on the Reviews tab (Figma 95:1863).
type ProfileReview struct {
	ShowtimeID string    `json:"showtimeId"`
	Film       string    `json:"film"`
	Stars      int       `json:"stars"`
	Tags       []string  `json:"tags"`
	Body       string    `json:"body"`
	Likes      int       `json:"likes"`
	Liked      bool      `json:"liked"`
	CreatedAt  time.Time `json:"createdAt"`
}

// ReviewsOf lists someone's reviews, newest first. People can hide them in Settings > Privacy.
func (s Store) ReviewsOf(ctx context.Context, me, id string) ([]ProfileReview, error) {
	rows, err := s.DB.Query(ctx, `SELECT r.showtime_id, s.film, r.stars, r.tags, r.body,
	    (SELECT count(*)::int FROM review_likes l WHERE l.author_id = r.account_id AND l.showtime_id = r.showtime_id),
	    EXISTS (SELECT 1 FROM review_likes l WHERE l.account_id = $1 AND l.author_id = r.account_id AND l.showtime_id = r.showtime_id),
	    r.created_at
	  FROM reviews r JOIN showtimes s ON s.id = r.showtime_id JOIN accounts a ON a.id = r.account_id
	  WHERE r.account_id::text = $2 AND NOT r.hidden AND (a.id = $1::uuid OR coalesce((a.prefs->>'showReviews')::boolean, true))
	  ORDER BY r.created_at DESC LIMIT 100`, me, id)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (ProfileReview, error) {
		var x ProfileReview
		return x, r.Scan(&x.ShowtimeID, &x.Film, &x.Stars, &x.Tags, &x.Body, &x.Likes, &x.Liked, &x.CreatedAt)
	})
}

// LikeReview likes or unlikes a review. Nobody can like their own. It reports whether anything changed.
func (s Store) LikeReview(ctx context.Context, me, author, showtime string, on bool) (bool, int, error) {
	if me == author {
		return false, 0, ErrForbidden
	}
	var ok bool
	err := s.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM reviews r JOIN accounts a ON a.id = r.account_id
	    WHERE r.account_id::text = $1 AND r.showtime_id = $2 AND NOT r.hidden AND coalesce((a.prefs->>'showReviews')::boolean, true)
	    AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $3 AND b.blocked_id = a.id) OR (b.blocker_id = a.id AND b.blocked_id = $3)))`, author, showtime, me).Scan(&ok)
	if err != nil {
		return false, 0, err
	}
	if !ok {
		return false, 0, ErrNotFound
	}
	var tag interface{ RowsAffected() int64 }
	if on {
		tag, err = s.DB.Exec(ctx, `INSERT INTO review_likes (account_id, author_id, showtime_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, me, author, showtime)
	} else {
		tag, err = s.DB.Exec(ctx, `DELETE FROM review_likes WHERE account_id = $1 AND author_id = $2 AND showtime_id = $3`, me, author, showtime)
	}
	if err != nil {
		return false, 0, err
	}
	var n int
	err = s.DB.QueryRow(ctx, `SELECT count(*)::int FROM review_likes WHERE author_id = $1 AND showtime_id = $2`, author, showtime).Scan(&n)
	return tag.RowsAffected() > 0, n, err
}

// Badge is one tile on the Badges tab (Figma 95:2002). Progress counts toward Goal.
type Badge struct {
	Key      string `json:"key"`
	Name     string `json:"name"`
	About    string `json:"about"`
	Letter   string `json:"letter"`
	Color    string `json:"color"`
	Progress int    `json:"progress"`
	Goal     int    `json:"goal"`
	Earned   bool   `json:"earned"`
}

// zones gives a home time zone per country, for "after midnight". Others use UTC.
var zones = map[string]string{
	"NG": "Africa/Lagos", "GH": "Africa/Accra", "KE": "Africa/Nairobi", "ZA": "Africa/Johannesburg", "EG": "Africa/Cairo",
	"SN": "Africa/Dakar", "CM": "Africa/Douala", "IN": "Asia/Kolkata", "KR": "Asia/Seoul", "JP": "Asia/Tokyo", "CN": "Asia/Shanghai",
	"AE": "Asia/Dubai", "GB": "Europe/London", "FR": "Europe/Paris", "DE": "Europe/Berlin", "ES": "Europe/Madrid", "IT": "Europe/Rome",
	"NL": "Europe/Amsterdam", "US": "America/New_York", "CA": "America/Toronto", "BR": "America/Sao_Paulo", "MX": "America/Mexico_City",
}

func (s Store) Badges(ctx context.Context, id string) ([]Badge, error) {
	var country string
	var joined time.Time
	if err := s.DB.QueryRow(ctx, `SELECT coalesce(country, ''), created_at FROM accounts WHERE id::text = $1`, id).Scan(&country, &joined); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	zone := zones[country]
	if zone == "" {
		zone = "UTC"
	}
	var premieres, late, vr, globe, host, critic, langs int
	err := s.DB.QueryRow(ctx, `SELECT
	    (SELECT count(*)::int FROM (`+watchedSQL+`) w),
	    (SELECT count(*)::int FROM (`+watchedSQL+`) w JOIN showtimes s ON s.id = w.showtime_id WHERE (s.starts_at AT TIME ZONE $2)::time < '05:00'),
	    (SELECT count(*)::int FROM holds h JOIN showtimes s ON s.id = h.showtime_id WHERE h.account_id = $1 AND h.status = 'paid' AND h.quality = 'vr' AND s.starts_at < now()),
	    (SELECT count(DISTINCT o.country)::int FROM party_members me JOIN party_members pm ON pm.party_id = me.party_id JOIN accounts o ON o.id = pm.account_id
	       WHERE me.account_id = $1 AND o.country IS NOT NULL),
	    (SELECT coalesce(max(n), 0)::int FROM (SELECT count(*) AS n FROM parties p JOIN party_members pm ON pm.party_id = p.id WHERE p.host_id = $1 GROUP BY p.id) h),
	    (SELECT count(*)::int FROM reviews r WHERE r.account_id = $1 AND NOT r.hidden
	       AND (SELECT count(*) FROM review_likes l WHERE l.author_id = r.account_id AND l.showtime_id = r.showtime_id) >= 100),
	    (SELECT count(DISTINCT audio)::int FROM watch_beats WHERE account_id = $1 AND audio <> '')`, id, zone).
		Scan(&premieres, &late, &vr, &globe, &host, &critic, &langs)
	if err != nil {
		return nil, err
	}
	founding := 0
	if joined.Year() <= 2026 {
		founding = 1
	}
	list := []Badge{
		{Key: "first-premiere", Name: "First premiere", About: "Watched your first live premiere", Letter: "F", Color: "#e3182d", Progress: premieres, Goal: 1},
		{Key: "globe-trotter", Name: "Globe trotter", About: "Joined rooms in 5 countries", Letter: "G", Color: "#2bb3a3", Progress: globe, Goal: 5},
		{Key: "night-owl", Name: "Night owl", About: "10 premieres after midnight", Letter: "N", Color: "#8b7cf6", Progress: late, Goal: 10},
		{Key: "vr-pioneer", Name: "VR pioneer", About: "First film in a VR hall", Letter: "V", Color: "#d4a23a", Progress: vr, Goal: 1},
		{Key: "host", Name: "Host", About: "Hosted a room of 100+", Letter: "H", Color: "#2f6fed", Progress: host, Goal: 100},
		{Key: "critic", Name: "Critic", About: "25 reviews with 100+ likes", Letter: "C", Color: "#e85d9a", Progress: critic, Goal: 25},
		{Key: "polyglot", Name: "Polyglot", About: "Watched in 5 languages", Letter: "P", Color: "#3fb950", Progress: langs, Goal: 5},
		{Key: "founding-member", Name: "Founding member", About: "Joined in 2026", Letter: "F", Color: "#e3182d", Progress: founding, Goal: 1},
	}
	for i := range list {
		if list[i].Progress >= list[i].Goal {
			list[i].Progress, list[i].Earned = list[i].Goal, true
		}
	}
	return list, nil
}
