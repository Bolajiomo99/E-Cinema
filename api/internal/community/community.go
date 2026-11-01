// Package community holds groups, posts, polls, likes, comments and follows (Figma 32:951,
// 96:1566). Posts are public to signed-in viewers; posting in a group needs membership.
package community

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound  = errors.New("not found")
	ErrNotMember = errors.New("join the group first")
	ErrForbidden = errors.New("not allowed")
	ErrBadInput  = errors.New("bad input")
	ErrTaken     = errors.New("a group with that name already exists")
	ErrClosed    = errors.New("this poll has closed")
	ErrTooMany   = errors.New("slow down a little")
)

const PageSize = 20

type Store struct{ DB *pgxpool.Pool }

type Community struct {
	ID         string    `json:"id"`
	Slug       string    `json:"slug"`
	Name       string    `json:"name"`
	About      string    `json:"about"`
	Rules      string    `json:"rules"`
	Visibility string    `json:"visibility"`
	Members    int       `json:"members"`
	Joined     bool      `json:"joined"`
	Role       string    `json:"role,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
	Countries  []string  `json:"countries,omitempty"` // where most members are, on the group page
}

type Member struct {
	Author
	Role     string    `json:"role"`
	JoinedAt time.Time `json:"joinedAt"`
}

type Party struct {
	Code     string    `json:"code"`
	Name     string    `json:"name"`
	Film     string    `json:"film"`
	StartsAt time.Time `json:"startsAt"`
}

type Author struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Country string `json:"country"`
}

type Option struct {
	Label string `json:"label"`
	Votes int    `json:"votes"`
}

type Post struct {
	ID         int64  `json:"id"`
	Kind       string `json:"kind"`
	Body       string `json:"body"`
	Lang       string `json:"lang"`
	MediaKey   string `json:"mediaKey,omitempty"`
	Film       string `json:"film,omitempty"`
	ShowtimeID string `json:"showtimeId,omitempty"`
	Author     Author `json:"author"`
	Community  *struct {
		Slug string `json:"slug"`
		Name string `json:"name"`
	} `json:"community,omitempty"`
	Pinned      bool       `json:"pinned"`
	Likes       int        `json:"likes"`
	Comments    int        `json:"comments"`
	Shares      int        `json:"shares"`
	Liked       bool       `json:"liked"`
	Options     []Option   `json:"options,omitempty"`
	MyVote      *int       `json:"myVote,omitempty"`
	PollEndsAt  *time.Time `json:"pollEndsAt,omitempty"`
	CanModerate bool       `json:"canModerate"`
	CreatedAt   time.Time  `json:"createdAt"`
}

type Comment struct {
	ID        int64     `json:"id"`
	Author    Author    `json:"author"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"createdAt"`
	Mine      bool      `json:"mine"`
}

type Person struct {
	Author
	Note      string `json:"note"`
	Following bool   `json:"following"`
}

type Tag struct {
	Tag   string `json:"tag"`
	Posts int    `json:"posts"`
}

// ---- groups ----

const communityCols = `c.id::text, c.slug, c.name, c.about, c.rules, c.visibility, c.members,
  m.account_id IS NOT NULL, coalesce(m.role, ''), c.created_at`

func scanCommunity(r pgx.Row) (Community, error) {
	var c Community
	err := r.Scan(&c.ID, &c.Slug, &c.Name, &c.About, &c.Rules, &c.Visibility, &c.Members, &c.Joined, &c.Role, &c.CreatedAt)
	return c, err
}

// List shows groups: mine first, then the biggest public ones.
func (s Store) List(ctx context.Context, me string) ([]Community, error) {
	rows, err := s.DB.Query(ctx, `SELECT `+communityCols+` FROM communities c
	  LEFT JOIN community_members m ON m.community_id = c.id AND m.account_id = $1
	  WHERE c.visibility = 'public' OR m.account_id IS NOT NULL
	  ORDER BY (m.account_id IS NOT NULL) DESC, c.members DESC, c.name LIMIT 60`, me)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Community, error) { return scanCommunity(r) })
}

// Get is one group with its upcoming parties.
func (s Store) Get(ctx context.Context, me, slug string) (Community, []Party, error) {
	c, err := scanCommunity(s.DB.QueryRow(ctx, `SELECT `+communityCols+` FROM communities c
	  LEFT JOIN community_members m ON m.community_id = c.id AND m.account_id = $1 WHERE c.slug = $2`, me, slug))
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && c.Visibility == "private" && !c.Joined) {
		return c, nil, ErrNotFound
	}
	if err != nil {
		return c, nil, err
	}
	rows, err := s.DB.Query(ctx, `SELECT p.code, p.name, st.film, st.starts_at FROM parties p JOIN showtimes st ON st.id = p.showtime_id
	  WHERE p.community_id = $1 AND p.visibility = 'link' AND st.starts_at + make_interval(mins => st.duration_min) > now()
	  ORDER BY st.starts_at LIMIT 5`, c.ID)
	if err != nil {
		return c, nil, err
	}
	parties, err := pgx.CollectRows(rows, pgx.RowToStructByPos[Party])
	if err != nil {
		return c, nil, err
	}
	rows, err = s.DB.Query(ctx, `SELECT a.country FROM community_members m JOIN accounts a ON a.id = m.account_id
	  WHERE m.community_id = $1 AND coalesce(a.country, '') <> '' GROUP BY a.country ORDER BY count(*) DESC, a.country LIMIT 3`, c.ID)
	if err != nil {
		return c, nil, err
	}
	c.Countries, err = pgx.CollectRows(rows, pgx.RowTo[string])
	return c, parties, err
}

// Members lists a group's people: owner and mods first, then newest.
func (s Store) Members(ctx context.Context, me, slug string) ([]Member, error) {
	if _, _, err := s.Get(ctx, me, slug); err != nil {
		return nil, err
	}
	rows, err := s.DB.Query(ctx, `SELECT a.id::text, a.name, coalesce(a.country, ''), m.role, m.joined_at FROM community_members m
	  JOIN communities c ON c.id = m.community_id JOIN accounts a ON a.id = m.account_id WHERE c.slug = $1
	  ORDER BY m.role <> 'owner', m.role <> 'mod', m.joined_at DESC LIMIT 100`, slug)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Member, error) {
		var m Member
		err := r.Scan(&m.ID, &m.Name, &m.Country, &m.Role, &m.JoinedAt)
		return m, err
	})
}

// ListParty shows a party I host on a group I belong to (or takes it off with list=false).
func (s Store) ListParty(ctx context.Context, me, slug, code string, list bool) error {
	tag, err := s.DB.Exec(ctx, `UPDATE parties p SET community_id = CASE WHEN $4 THEN c.id ELSE NULL END FROM communities c
	  JOIN community_members m ON m.community_id = c.id AND m.account_id = $1
	  WHERE c.slug = $2 AND p.code = $3 AND p.host_id = $1 AND p.visibility = 'link' AND ($4 OR p.community_id = c.id)`, me, slug, code, list)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrForbidden
	}
	return err
}

var slugBad = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(name string) string {
	s := strings.Trim(slugBad.ReplaceAllString(strings.ToLower(name), "-"), "-")
	if len(s) > 50 {
		s = strings.Trim(s[:50], "-")
	}
	return s
}

// Create makes a group; its maker is the owner and first member.
func (s Store) Create(ctx context.Context, me, name, about, visibility string) (Community, error) {
	name, about = strings.TrimSpace(name), strings.TrimSpace(about)
	slug := slugify(name)
	if n := utf8.RuneCountInString(name); n < 3 || n > 60 || len(slug) < 3 || utf8.RuneCountInString(about) > 400 || (visibility != "public" && visibility != "private") {
		return Community{}, ErrBadInput
	}
	var made int
	if err := s.DB.QueryRow(ctx, `SELECT count(*) FROM communities WHERE created_by = $1 AND created_at > now() - interval '1 day'`, me).Scan(&made); err != nil {
		return Community{}, err
	}
	if made >= 3 {
		return Community{}, ErrTooMany
	}
	err := pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		var id string
		err := tx.QueryRow(ctx, `INSERT INTO communities (slug, name, about, visibility, created_by, members) VALUES ($1, $2, $3, $4, $5, 1)
		  ON CONFLICT DO NOTHING RETURNING id::text`, slug, name, about, visibility, me).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrTaken
		}
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO community_members (community_id, account_id, role) VALUES ($1, $2, 'owner')`, id, me)
		return err
	})
	if err != nil {
		return Community{}, err
	}
	c, _, err := s.Get(ctx, me, slug)
	return c, err
}

// Join adds me to a public group.
func (s Store) Join(ctx context.Context, me, slug string) error {
	return pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		var id, vis string
		if err := tx.QueryRow(ctx, `SELECT id::text, visibility FROM communities WHERE slug = $1 FOR UPDATE`, slug).Scan(&id, &vis); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if vis != "public" {
			return ErrForbidden
		}
		tag, err := tx.Exec(ctx, `INSERT INTO community_members (community_id, account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, id, me)
		if err == nil && tag.RowsAffected() == 1 {
			_, err = tx.Exec(ctx, `UPDATE communities SET members = members + 1 WHERE id = $1`, id)
		}
		return err
	})
}

// Leave removes me. The owner stays: a group always has someone in charge.
func (s Store) Leave(ctx context.Context, me, slug string) error {
	return pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		var id, role string
		err := tx.QueryRow(ctx, `SELECT c.id::text, m.role FROM communities c JOIN community_members m ON m.community_id = c.id AND m.account_id = $2
		  WHERE c.slug = $1 FOR UPDATE OF c`, slug, me).Scan(&id, &role)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotMember
		}
		if err != nil {
			return err
		}
		if role == "owner" {
			return ErrForbidden
		}
		if _, err := tx.Exec(ctx, `DELETE FROM community_members WHERE community_id = $1 AND account_id = $2`, id, me); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE communities SET members = greatest(members - 1, 0) WHERE id = $1`, id)
		return err
	})
}

// ---- posts ----

type NewPost struct {
	Community  string   `json:"community"` // slug, or "" for my own profile feed
	Kind       string   `json:"kind"`
	Body       string   `json:"body"`
	Lang       string   `json:"lang"`
	MediaKey   string   `json:"mediaKey"`
	ShowtimeID string   `json:"showtimeId"`
	Options    []string `json:"options"`
	PollHours  int      `json:"pollHours"`
}

var (
	tagRe   = regexp.MustCompile(`#([\p{L}\p{M}\p{N}_]{2,40})`)
	langRe  = regexp.MustCompile(`^([a-z]{2,3})?$`)
	mediaRe = regexp.MustCompile(`^posts/[0-9a-f-]{36}\.(jpg|png|webp)$`)
)

// Tags pulls #hashtags out of a post, lower-cased, at most 10.
func Tags(body string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, m := range tagRe.FindAllStringSubmatch(body, -1) {
		t := strings.ToLower(m[1])
		if !seen[t] && len(out) < 10 {
			seen[t] = true
			out = append(out, t)
		}
	}
	return out
}

func (n *NewPost) valid() bool {
	n.Body = strings.TrimSpace(n.Body)
	if utf8.RuneCountInString(n.Body) > 2000 || !langRe.MatchString(n.Lang) {
		return false
	}
	switch n.Kind {
	case "text":
		return n.Body != "" && n.MediaKey == "" && len(n.Options) == 0
	case "photo":
		return mediaRe.MatchString(n.MediaKey) && len(n.Options) == 0
	case "poll":
		if n.Body == "" || n.MediaKey != "" || len(n.Options) < 2 || len(n.Options) > 6 || n.PollHours < 1 || n.PollHours > 168 {
			return false
		}
		for i, o := range n.Options {
			n.Options[i] = strings.TrimSpace(o)
			if l := utf8.RuneCountInString(n.Options[i]); l < 1 || l > 80 {
				return false
			}
		}
		return true
	}
	return false
}

// Create a post. Ten posts a minute is plenty for a person.
func (s Store) Post(ctx context.Context, me string, n NewPost) (int64, error) {
	if !n.valid() {
		return 0, ErrBadInput
	}
	var id int64
	err := pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		var recent int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM posts WHERE author_id = $1 AND created_at > now() - interval '1 minute'`, me).Scan(&recent); err != nil {
			return err
		}
		if recent >= 10 {
			return ErrTooMany
		}
		var community *string
		if n.Community != "" {
			var cid string
			err := tx.QueryRow(ctx, `SELECT c.id::text FROM communities c JOIN community_members m ON m.community_id = c.id AND m.account_id = $2 WHERE c.slug = $1`, n.Community, me).Scan(&cid)
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotMember
			}
			if err != nil {
				return err
			}
			community = &cid
		}
		var showtime, media *string
		if n.ShowtimeID != "" {
			showtime = &n.ShowtimeID
		}
		if n.MediaKey != "" {
			media = &n.MediaKey
		}
		var ends *time.Time
		if n.Kind == "poll" {
			t := time.Now().Add(time.Duration(n.PollHours) * time.Hour)
			ends = &t
		}
		err := tx.QueryRow(ctx, `INSERT INTO posts (community_id, author_id, kind, body, lang, media_key, showtime_id, poll_ends_at, tags)
		  VALUES ($1, $2, $3, $4, $5, $6, (SELECT id FROM showtimes WHERE id = $7), $8, $9) RETURNING id`,
			community, me, n.Kind, n.Body, n.Lang, media, showtime, ends, Tags(n.Body)).Scan(&id)
		if err != nil {
			return err
		}
		for i, o := range n.Options {
			if _, err := tx.Exec(ctx, `INSERT INTO poll_options (post_id, idx, label) VALUES ($1, $2, $3)`, id, i, o); err != nil {
				return err
			}
		}
		return nil
	})
	return id, err
}

// Feed filters. Zero value is everything public, newest first.
type Feed struct {
	Community string // slug
	Following bool   // people I follow and groups I'm in
	Author    string // account id
	Tag       string
	Before    int64
	PostID    int64
}

const postCols = `p.id, p.kind, p.body, p.lang, coalesce(p.media_key, ''), coalesce(st.film, ''), coalesce(p.showtime_id, ''),
  a.id::text, a.name, coalesce(a.country, ''), coalesce(c.slug, ''), coalesce(c.name, ''),
  p.pinned, p.likes, p.comments, p.shares, l.account_id IS NOT NULL, v.idx, p.poll_ends_at,
  (p.author_id = $1 OR coalesce(mm.role, '') IN ('owner', 'mod')), p.created_at`

// Posts lists a feed page.
func (s Store) Posts(ctx context.Context, me string, f Feed) ([]Post, error) {
	where := []string{"p.deleted_at IS NULL", "(c.id IS NULL OR c.visibility = 'public' OR mm.account_id IS NOT NULL)",
		`NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = p.author_id) OR (b.blocker_id = p.author_id AND b.blocked_id = $1))`}
	args := []any{me}
	arg := func(v any) string { args = append(args, v); return "$" + itoa(len(args)) }
	order := "p.created_at DESC, p.id DESC"
	if f.PostID > 0 {
		where = append(where, "p.id = "+arg(f.PostID))
	}
	if f.Community != "" {
		where = append(where, "c.slug = "+arg(f.Community))
		order = "p.pinned DESC, " + order
	}
	if f.Author != "" {
		where = append(where, "p.author_id::text = "+arg(f.Author))
	}
	if f.Tag != "" {
		where = append(where, arg(strings.ToLower(f.Tag))+" = ANY (p.tags)")
	}
	if f.Following {
		where = append(where, `(p.author_id = $1 OR p.author_id IN (SELECT followee_id FROM follows WHERE follower_id = $1) OR mm.account_id IS NOT NULL)`)
	}
	if f.Before > 0 {
		where = append(where, "p.id < "+arg(f.Before))
	}
	rows, err := s.DB.Query(ctx, `SELECT `+postCols+` FROM posts p
	  JOIN accounts a ON a.id = p.author_id
	  LEFT JOIN communities c ON c.id = p.community_id
	  LEFT JOIN community_members mm ON mm.community_id = p.community_id AND mm.account_id = $1
	  LEFT JOIN showtimes st ON st.id = p.showtime_id
	  LEFT JOIN post_likes l ON l.post_id = p.id AND l.account_id = $1
	  LEFT JOIN poll_votes v ON v.post_id = p.id AND v.account_id = $1
	  WHERE `+strings.Join(where, " AND ")+` ORDER BY `+order+` LIMIT `+itoa(PageSize), args...)
	if err != nil {
		return nil, err
	}
	posts, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Post, error) {
		var p Post
		var slug, cname string
		var vote *int16
		err := r.Scan(&p.ID, &p.Kind, &p.Body, &p.Lang, &p.MediaKey, &p.Film, &p.ShowtimeID, &p.Author.ID, &p.Author.Name, &p.Author.Country,
			&slug, &cname, &p.Pinned, &p.Likes, &p.Comments, &p.Shares, &p.Liked, &vote, &p.PollEndsAt, &p.CanModerate, &p.CreatedAt)
		if slug != "" {
			p.Community = &struct {
				Slug string `json:"slug"`
				Name string `json:"name"`
			}{slug, cname}
		}
		if vote != nil {
			v := int(*vote)
			p.MyVote = &v
		}
		return p, err
	})
	if err != nil || len(posts) == 0 {
		return posts, err
	}
	ids := []int64{}
	for _, p := range posts {
		if p.Kind == "poll" {
			ids = append(ids, p.ID)
		}
	}
	if len(ids) > 0 {
		rows, err := s.DB.Query(ctx, `SELECT post_id, label, votes FROM poll_options WHERE post_id = ANY($1) ORDER BY post_id, idx`, ids)
		if err != nil {
			return nil, err
		}
		opts := map[int64][]Option{}
		for rows.Next() {
			var id int64
			var o Option
			if err := rows.Scan(&id, &o.Label, &o.Votes); err != nil {
				rows.Close()
				return nil, err
			}
			opts[id] = append(opts[id], o)
		}
		rows.Close()
		for i := range posts {
			posts[i].Options = opts[posts[i].ID]
		}
	}
	return posts, rows.Err()
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for ; n > 0; n /= 10 {
		b = append([]byte{byte('0' + n%10)}, b...)
	}
	return string(b)
}

// visible checks I may see a post (exists, not deleted, group public or mine) and returns its author.
func visible(ctx context.Context, tx pgx.Tx, me string, post int64) (string, error) {
	var author string
	err := tx.QueryRow(ctx, `SELECT p.author_id::text FROM posts p LEFT JOIN communities c ON c.id = p.community_id
	  LEFT JOIN community_members m ON m.community_id = c.id AND m.account_id = $2
	  WHERE p.id = $1 AND p.deleted_at IS NULL AND (c.id IS NULL OR c.visibility = 'public' OR m.account_id IS NOT NULL)`, post, me).Scan(&author)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return author, err
}

// Like turns my like on or off and returns the new count and the author (for a notification).
func (s Store) Like(ctx context.Context, me string, post int64, on bool) (likes int, author string, changed bool, err error) {
	err = pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		if author, err = visible(ctx, tx, me, post); err != nil {
			return err
		}
		q := `INSERT INTO post_likes (post_id, account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`
		d := "+ 1"
		if !on {
			q, d = `DELETE FROM post_likes WHERE post_id = $1 AND account_id = $2`, "- 1"
		}
		tag, err := tx.Exec(ctx, q, post, me)
		if err != nil {
			return err
		}
		changed = tag.RowsAffected() == 1
		if changed {
			_, err = tx.Exec(ctx, `UPDATE posts SET likes = greatest(likes `+d+`, 0) WHERE id = $1`, post)
			if err != nil {
				return err
			}
		}
		return tx.QueryRow(ctx, `SELECT likes FROM posts WHERE id = $1`, post).Scan(&likes)
	})
	return
}

// Vote records my one vote on a poll while it is open.
func (s Store) Vote(ctx context.Context, me string, post int64, idx int) ([]Option, error) {
	var opts []Option
	err := pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		if _, err := visible(ctx, tx, me, post); err != nil {
			return err
		}
		var open bool
		if err := tx.QueryRow(ctx, `SELECT kind = 'poll' AND poll_ends_at > now() FROM posts WHERE id = $1`, post).Scan(&open); err != nil {
			return err
		}
		if !open {
			return ErrClosed
		}
		tag, err := tx.Exec(ctx, `UPDATE poll_options SET votes = votes + 1 WHERE post_id = $1 AND idx = $2`, post, idx)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrBadInput
		}
		tag, err = tx.Exec(ctx, `INSERT INTO poll_votes (post_id, account_id, idx) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, post, me, idx)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrForbidden // already voted; the update above rolls back
		}
		rows, err := tx.Query(ctx, `SELECT label, votes FROM poll_options WHERE post_id = $1 ORDER BY idx`, post)
		if err != nil {
			return err
		}
		opts, err = pgx.CollectRows(rows, pgx.RowToStructByPos[Option])
		return err
	})
	return opts, err
}

// AddComment adds my comment and returns it with the post's author.
func (s Store) AddComment(ctx context.Context, me string, post int64, body string) (Comment, string, error) {
	body = strings.TrimSpace(body)
	if l := utf8.RuneCountInString(body); l < 1 || l > 1000 {
		return Comment{}, "", ErrBadInput
	}
	var c Comment
	var author string
	err := pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		var err error
		if author, err = visible(ctx, tx, me, post); err != nil {
			return err
		}
		var recent int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM post_comments WHERE author_id = $1 AND created_at > now() - interval '1 minute'`, me).Scan(&recent); err != nil {
			return err
		}
		if recent >= 20 {
			return ErrTooMany
		}
		err = tx.QueryRow(ctx, `WITH c AS (INSERT INTO post_comments (post_id, author_id, body) VALUES ($1, $2, $3) RETURNING id, body, created_at)
		  SELECT c.id, a.id::text, a.name, coalesce(a.country, ''), c.body, c.created_at FROM c, accounts a WHERE a.id = $2`, post, me, body).
			Scan(&c.ID, &c.Author.ID, &c.Author.Name, &c.Author.Country, &c.Body, &c.CreatedAt)
		if err != nil {
			return err
		}
		c.Mine = true
		_, err = tx.Exec(ctx, `UPDATE posts SET comments = comments + 1 WHERE id = $1`, post)
		return err
	})
	return c, author, err
}

// Comments lists a post's comments, oldest first.
func (s Store) Comments(ctx context.Context, me string, post int64) ([]Comment, error) {
	var out []Comment
	err := pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		if _, err := visible(ctx, tx, me, post); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `SELECT c.id, a.id::text, a.name, coalesce(a.country, ''), c.body, c.created_at, c.author_id = $2
		  FROM post_comments c JOIN accounts a ON a.id = c.author_id WHERE c.post_id = $1 AND c.deleted_at IS NULL ORDER BY c.id LIMIT 200`, post, me)
		if err != nil {
			return err
		}
		out, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Comment, error) {
			var c Comment
			err := r.Scan(&c.ID, &c.Author.ID, &c.Author.Name, &c.Author.Country, &c.Body, &c.CreatedAt, &c.Mine)
			return c, err
		})
		return err
	})
	return out, err
}

// Delete removes a post: its author, or a group's owner or mod.
func (s Store) Delete(ctx context.Context, me string, post int64) error {
	tag, err := s.DB.Exec(ctx, `UPDATE posts p SET deleted_at = now() WHERE p.id = $1 AND p.deleted_at IS NULL AND (p.author_id = $2 OR EXISTS (
	  SELECT 1 FROM community_members m WHERE m.community_id = p.community_id AND m.account_id = $2 AND m.role IN ('owner', 'mod')))`, post, me)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrForbidden
	}
	return err
}

// Pin pins or unpins a group post: owners and mods only.
func (s Store) Pin(ctx context.Context, me string, post int64, on bool) error {
	tag, err := s.DB.Exec(ctx, `UPDATE posts p SET pinned = $3 WHERE p.id = $1 AND p.deleted_at IS NULL AND EXISTS (
	  SELECT 1 FROM community_members m WHERE m.community_id = p.community_id AND m.account_id = $2 AND m.role IN ('owner', 'mod'))`, post, me, on)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrForbidden
	}
	return err
}

// Report flags a post for review. Five reports hide it until a person looks.
func (s Store) Report(ctx context.Context, me string, post int64, reason string) error {
	switch reason {
	case "spam", "abuse", "spoiler", "piracy", "other":
	default:
		return ErrBadInput
	}
	return pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		if _, err := visible(ctx, tx, me, post); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO post_reports (post_id, reporter_id, reason) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, post, me, reason); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `UPDATE posts SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL AND (SELECT count(*) FROM post_reports WHERE post_id = $1) >= 5`, post)
		return err
	})
}

// Shared counts a share of a post (to a chat or copied link).
func (s Store) Shared(ctx context.Context, me string, post int64) (int, error) {
	var n int
	err := pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		if _, err := visible(ctx, tx, me, post); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `UPDATE posts SET shares = shares + 1 WHERE id = $1 RETURNING shares`, post).Scan(&n)
	})
	return n, err
}

// ---- people ----

// Follow turns following on or off. It reports whether anything changed.
func (s Store) Follow(ctx context.Context, me, them string, on bool) (bool, error) {
	if me == them {
		return false, ErrBadInput
	}
	q := `INSERT INTO follows (follower_id, followee_id) SELECT $1, id FROM accounts WHERE id::text = $2 ON CONFLICT DO NOTHING`
	if !on {
		q = `DELETE FROM follows WHERE follower_id = $1 AND followee_id::text = $2`
	}
	tag, err := s.DB.Exec(ctx, q, me, them)
	return err == nil && tag.RowsAffected() == 1, err
}

// Suggestions are people to follow: active posters in my groups, then anyone active, not
// already followed, not blocked.
func (s Store) Suggestions(ctx context.Context, me string) ([]Person, error) {
	rows, err := s.DB.Query(ctx, `SELECT a.id::text, a.name, coalesce(a.country, ''),
	    coalesce((SELECT c.name FROM posts p2 JOIN communities c ON c.id = p2.community_id WHERE p2.author_id = a.id AND p2.deleted_at IS NULL ORDER BY p2.id DESC LIMIT 1), '')
	  FROM accounts a JOIN (
	    SELECT p.author_id, count(*) n, bool_or(m.account_id IS NOT NULL) shared FROM posts p
	    LEFT JOIN community_members m ON m.community_id = p.community_id AND m.account_id = $1
	    WHERE p.deleted_at IS NULL AND p.created_at > now() - interval '30 days' GROUP BY p.author_id) s ON s.author_id = a.id
	  WHERE a.id <> $1 AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followee_id = a.id)
	    AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = a.id) OR (b.blocker_id = a.id AND b.blocked_id = $1))
	  ORDER BY s.shared DESC, s.n DESC LIMIT 5`, me)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Person, error) {
		var p Person
		err := r.Scan(&p.ID, &p.Name, &p.Country, &p.Note)
		return p, err
	})
}

// Trending is the most used tags this week, by people in a country when one is given.
func (s Store) Trending(ctx context.Context, country string) ([]Tag, error) {
	rows, err := s.DB.Query(ctx, `SELECT t, count(*)::int FROM posts p JOIN accounts a ON a.id = p.author_id, unnest(p.tags) t
	  WHERE p.deleted_at IS NULL AND p.created_at > now() - interval '7 days' AND ($1 = '' OR a.country = $1)
	  GROUP BY t ORDER BY count(*) DESC, t LIMIT 5`, country)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Tag])
}

// ---- translation cache ----

// Source is the text to translate for a post I can see.
func (s Store) Source(ctx context.Context, me string, post int64) (body, lang string, err error) {
	err = pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		if _, err := visible(ctx, tx, me, post); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `SELECT body, lang FROM posts WHERE id = $1`, post).Scan(&body, &lang)
	})
	return
}

func (s Store) Translation(ctx context.Context, post int64, lang string) (string, string, error) {
	var body, source string
	err := s.DB.QueryRow(ctx, `SELECT body, source FROM post_translations WHERE post_id = $1 AND lang = $2`, post, lang).Scan(&body, &source)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", ErrNotFound
	}
	return body, source, err
}

func (s Store) SaveTranslation(ctx context.Context, post int64, lang, body, source string) error {
	if !langRe.MatchString(lang) || lang == "" || utf8.RuneCountInString(body) > 4000 || !langRe.MatchString(source) {
		return ErrBadInput
	}
	_, err := s.DB.Exec(ctx, `INSERT INTO post_translations (post_id, lang, body, source) VALUES ($1, $2, $3, $4)
	  ON CONFLICT (post_id, lang) DO UPDATE SET body = excluded.body, source = excluded.source`, post, lang, body, source)
	if err == nil && source != "" {
		_, err = s.DB.Exec(ctx, `UPDATE posts SET lang = $2 WHERE id = $1 AND lang = ''`, post, source)
	}
	return err
}

// CountryOf is a viewer's country code, for "Trending in <country>".
func (s Store) CountryOf(ctx context.Context, id string) string {
	var c string
	_ = s.DB.QueryRow(ctx, `SELECT coalesce(country, '') FROM accounts WHERE id = $1`, id).Scan(&c)
	return c
}

// Profile is what the Community page shows about one person.
type Profile struct {
	Author
	Following bool `json:"following"`
	Followers int  `json:"followers"`
	Follows   int  `json:"follows"`
	Posts     int  `json:"posts"`
}

func (s Store) Profile(ctx context.Context, me, id string) (Profile, error) {
	var p Profile
	err := s.DB.QueryRow(ctx, `SELECT a.id::text, a.name, coalesce(a.country, ''),
	    EXISTS (SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = a.id),
	    (SELECT count(*)::int FROM follows WHERE followee_id = a.id), (SELECT count(*)::int FROM follows WHERE follower_id = a.id),
	    (SELECT count(*)::int FROM posts WHERE author_id = a.id AND deleted_at IS NULL)
	  FROM accounts a WHERE a.id::text = $2
	    AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = a.id) OR (b.blocker_id = a.id AND b.blocked_id = $1))`, me, id).
		Scan(&p.ID, &p.Name, &p.Country, &p.Following, &p.Followers, &p.Follows, &p.Posts)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, ErrNotFound
	}
	return p, err
}
