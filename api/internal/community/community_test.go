package community_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/community"
	"github.com/Bolajiomo99/E-Cinema/api/internal/db"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestCommunity(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	p, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	if err := db.Migrate(ctx, p); err != nil {
		t.Fatal(err)
	}
	s := community.Store{DB: p}
	run := fmt.Sprint(time.Now().UnixNano())
	id := func(name, country string) string {
		var x string
		if err := p.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash, country, app_language) VALUES ($1, $2, 'x', $3, 'en') RETURNING id`,
			"comm-"+run+"-"+strings.ToLower(name[:3])+"@example.com", name, country).Scan(&x); err != nil {
			t.Fatal(err)
		}
		return x
	}
	ada, tolu, eve := id("Ada Obi", "NG"), id("Tolu Kareem", "NG"), id("Eve Smith", "GB")

	// Starter groups exist; Ada makes her own and is its owner.
	list, err := s.List(ctx, ada)
	if err != nil || len(list) < 4 {
		t.Fatalf("list = %d %v", len(list), err)
	}
	name := "Film Club " + run[len(run)-6:]
	g, err := s.Create(ctx, ada, name, "Weekly watch nights.", "public")
	if err != nil || g.Role != "owner" || g.Members != 1 {
		t.Fatalf("create = %+v %v", g, err)
	}
	if _, err := s.Create(ctx, tolu, name, "", "public"); !errors.Is(err, community.ErrTaken) {
		t.Fatalf("duplicate: %v", err)
	}
	if err := s.Leave(ctx, ada, g.Slug); !errors.Is(err, community.ErrForbidden) {
		t.Fatalf("owner leave: %v", err)
	}

	// Posting in a group needs membership.
	if _, err := s.Post(ctx, tolu, community.NewPost{Community: g.Slug, Kind: "text", Body: "hi"}); !errors.Is(err, community.ErrNotMember) {
		t.Fatalf("non-member post: %v", err)
	}
	if err := s.Join(ctx, tolu, g.Slug); err != nil {
		t.Fatal(err)
	}
	if c, _, _ := s.Get(ctx, tolu, g.Slug); c.Members != 2 || !c.Joined {
		t.Fatalf("after join = %+v", c)
	}
	if m, err := s.Members(ctx, eve, g.Slug); err != nil || len(m) != 2 || m[0].ID != ada || m[0].Role != "owner" {
		t.Fatalf("members = %+v %v", m, err)
	}
	if c, _, _ := s.Get(ctx, eve, g.Slug); len(c.Countries) != 1 || c.Countries[0] != "NG" {
		t.Fatalf("countries = %+v", c.Countries)
	}
	if err := s.ListParty(ctx, eve, g.Slug, "no-such-party", true); !errors.Is(err, community.ErrForbidden) {
		t.Fatalf("list party: %v", err)
	}
	text, err := s.Post(ctx, tolu, community.NewPost{Community: g.Slug, Kind: "text", Body: "That storm scene! #TideOfLagos #tideoflagos #SnackScore"})
	if err != nil {
		t.Fatal(err)
	}
	poll, err := s.Post(ctx, ada, community.NewPost{Community: g.Slug, Kind: "poll", Body: "Who survives?", Options: []string{"Captain Ade", "The storm"}, PollHours: 3})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Post(ctx, ada, community.NewPost{Kind: "poll", Body: "x", Options: []string{"only one"}, PollHours: 3}); !errors.Is(err, community.ErrBadInput) {
		t.Fatalf("bad poll: %v", err)
	}

	// Likes, votes, comments.
	if n, author, changed, err := s.Like(ctx, ada, text, true); err != nil || n != 1 || author != tolu || !changed {
		t.Fatalf("like = %d %s %v %v", n, author, changed, err)
	}
	if n, _, changed, _ := s.Like(ctx, ada, text, true); n != 1 || changed {
		t.Fatalf("double like = %d %v", n, changed)
	}
	if opts, err := s.Vote(ctx, tolu, poll, 0); err != nil || opts[0].Votes != 1 {
		t.Fatalf("vote = %+v %v", opts, err)
	}
	if _, err := s.Vote(ctx, tolu, poll, 1); !errors.Is(err, community.ErrForbidden) {
		t.Fatalf("second vote: %v", err)
	}
	if c, author, err := s.AddComment(ctx, eve, text, "So good"); err != nil || author != tolu || c.Author.Name != "Eve Smith" {
		t.Fatalf("comment = %+v %v", c, err)
	}

	// Feeds: the group, a tag, and Following (Eve follows Tolu).
	posts, err := s.Posts(ctx, ada, community.Feed{Community: g.Slug})
	if err != nil || len(posts) != 2 || posts[0].ID != poll || len(posts[0].Options) != 2 || posts[1].Likes != 1 || !posts[1].Liked || posts[1].Comments != 1 {
		t.Fatalf("group feed = %+v %v", posts, err)
	}
	if posts[0].MyVote != nil || !posts[0].CanModerate || !posts[1].CanModerate {
		t.Fatalf("owner flags = %+v", posts)
	}
	if posts, _ := s.Posts(ctx, ada, community.Feed{Tag: "tideoflagos"}); len(posts) == 0 || posts[0].ID != text {
		t.Fatalf("tag feed = %+v", posts)
	}
	if posts, _ := s.Posts(ctx, eve, community.Feed{Following: true}); len(posts) != 0 {
		t.Fatalf("following before = %+v", posts)
	}
	if ok, err := s.Follow(ctx, eve, tolu, true); err != nil || !ok {
		t.Fatalf("follow = %v %v", ok, err)
	}
	if pr, err := s.Profile(ctx, eve, tolu); err != nil || !pr.Following || pr.Followers != 1 || pr.Posts != 1 {
		t.Fatalf("profile = %+v %v", pr, err)
	}
	if posts, _ := s.Posts(ctx, eve, community.Feed{Following: true}); len(posts) != 1 || posts[0].ID != text {
		t.Fatalf("following after = %+v", posts)
	}
	if tags, _ := s.Trending(ctx, "NG"); len(tags) == 0 {
		t.Fatalf("trending empty")
	}
	if sug, _ := s.Suggestions(ctx, eve); len(sug) == 0 {
		t.Fatalf("no suggestions")
	} else {
		for _, p := range sug {
			if p.ID == tolu {
				t.Fatalf("suggested someone already followed")
			}
		}
	}

	// Moderation: Ada (owner) pins and deletes; Eve cannot.
	if err := s.Pin(ctx, eve, text, true); !errors.Is(err, community.ErrForbidden) {
		t.Fatalf("eve pin: %v", err)
	}
	if err := s.Pin(ctx, ada, text, true); err != nil {
		t.Fatal(err)
	}
	if posts, _ := s.Posts(ctx, ada, community.Feed{Community: g.Slug}); posts[0].ID != text || !posts[0].Pinned {
		t.Fatalf("pinned first = %+v", posts[0])
	}
	if err := s.Delete(ctx, eve, text); !errors.Is(err, community.ErrForbidden) {
		t.Fatalf("eve delete: %v", err)
	}
	if err := s.Delete(ctx, ada, text); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := s.Like(ctx, eve, text, true); !errors.Is(err, community.ErrNotFound) {
		t.Fatalf("like deleted: %v", err)
	}

	// Translation cache.
	if err := s.SaveTranslation(ctx, poll, "yo", "Ta ni yoo ye?", "en"); err != nil {
		t.Fatal(err)
	}
	if body, src, err := s.Translation(ctx, poll, "yo"); err != nil || body != "Ta ni yoo ye?" || src != "en" {
		t.Fatalf("translation = %q %q %v", body, src, err)
	}
}

func TestTags(t *testing.T) {
	got := community.Tags("#One two #one #Ọ̀rọ̀ #x")
	if len(got) != 2 || got[0] != "one" {
		t.Fatalf("tags = %v", got)
	}
}
