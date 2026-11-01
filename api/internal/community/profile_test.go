package community_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/community"
	"github.com/Bolajiomo99/E-Cinema/api/internal/db"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestProfile(t *testing.T) {
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
	id := func(tag, name, country string) string {
		var x string
		if err := p.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash, country) VALUES ($1, $2, 'x', $3) RETURNING id`,
			"prof-"+run+"-"+tag+"@example.com", name, country).Scan(&x); err != nil {
			t.Fatal(err)
		}
		return x
	}
	ada, kim := id("a", "Ada Obi", "NG"), id("k", "Kim Lee", "KR")
	user := "ada" + run[len(run)-8:]
	if _, err := p.Exec(ctx, `UPDATE accounts SET username = $2 WHERE id = $1`, ada, user); err != nil {
		t.Fatal(err)
	}
	if err := s.EditProfile(ctx, ada, community.ProfileChange{City: " Lagos ", Interests: "Thrillers, K-drama, zobo", Spoken: []string{"English", "Yorùbá", "english"}}); err != nil {
		t.Fatal(err)
	}
	if err := s.EditProfile(ctx, ada, community.ProfileChange{Spoken: []string{"a", "b", "c", "d", "e", "f", "g"}}); !errors.Is(err, community.ErrBadInput) {
		t.Fatalf("too many languages: %v", err)
	}

	// A premiere counts after ten minutes in the live room; a two-minute visit does not.
	show, short := "red-earth-2026-11-02", "seoul-after-rain-2026-11-03"
	if _, err := p.Exec(ctx, `INSERT INTO watch_beats (account_id, showtime_id, day, mode, audio, seconds) VALUES
	    ($1, $2, current_date, 'room', 'yo', 900), ($1, $3, current_date, 'room', 'ko', 120)`, ada, show, short); err != nil {
		t.Fatal(err)
	}
	// Ada and Kim chatted in a watch room, so Ada has chatted with one country.
	if _, err := p.Exec(ctx, `INSERT INTO room_messages (showtime_id, account_id, name, body) VALUES ($1, $2, 'Ada', 'hi'), ($1, $3, 'Kim', 'hello')`, show, ada, kim); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, `INSERT INTO reviews (account_id, showtime_id, stars, body) VALUES ($1, $2, 5, 'The Yorùbá dub sounded like the real cast.')`, ada, show); err != nil {
		t.Fatal(err)
	}

	pg, err := s.ProfilePage(ctx, kim, user)
	if err != nil {
		t.Fatal(err)
	}
	if pg.ID != ada || pg.City != "Lagos" || len(pg.Spoken) != 2 || pg.Premieres != 1 || pg.Countries < 1 || pg.Reviews != 1 || pg.Me {
		t.Fatalf("page = %+v", pg)
	}
	w, err := s.WatchedList(ctx, ada)
	if err != nil || len(w) != 1 || w[0].Stars != 5 || w[0].Minutes != 15 {
		t.Fatalf("watched = %+v %v", w, err)
	}

	// Likes: Kim can like it once, Ada cannot like her own.
	if _, _, err := s.LikeReview(ctx, ada, ada, show, true); !errors.Is(err, community.ErrForbidden) {
		t.Fatalf("self like: %v", err)
	}
	changed, n, err := s.LikeReview(ctx, kim, ada, show, true)
	if err != nil || !changed || n != 1 {
		t.Fatalf("like = %v %d %v", changed, n, err)
	}
	if changed, _, _ := s.LikeReview(ctx, kim, ada, show, true); changed {
		t.Fatal("liked twice")
	}
	rv, err := s.ReviewsOf(ctx, kim, ada)
	if err != nil || len(rv) != 1 || rv[0].Likes != 1 || !rv[0].Liked || rv[0].Film != "Red Earth" {
		t.Fatalf("reviews = %+v %v", rv, err)
	}

	// Hiding reviews in Settings hides them from others but not from Ada.
	if _, err := p.Exec(ctx, `UPDATE accounts SET prefs = prefs || '{"showReviews": false}' WHERE id = $1`, ada); err != nil {
		t.Fatal(err)
	}
	if rv, _ := s.ReviewsOf(ctx, kim, ada); len(rv) != 0 {
		t.Fatal("hidden reviews shown")
	}
	if rv, _ := s.ReviewsOf(ctx, ada, ada); len(rv) != 1 {
		t.Fatal("own reviews hidden")
	}

	b, err := s.Badges(ctx, ada)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]community.Badge{}
	for _, x := range b {
		got[x.Key] = x
	}
	if !got["first-premiere"].Earned || got["polyglot"].Progress != 2 || got["polyglot"].Earned || !got["founding-member"].Earned || got["vr-pioneer"].Earned {
		t.Fatalf("badges = %+v", b)
	}

	// Blocking hides the profile both ways.
	if _, err := p.Exec(ctx, `INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)`, ada, kim); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ProfilePage(ctx, kim, ada); !errors.Is(err, community.ErrNotFound) {
		t.Fatalf("blocked: %v", err)
	}
}
