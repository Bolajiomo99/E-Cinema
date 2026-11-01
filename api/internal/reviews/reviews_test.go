package reviews_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/db"
	"github.com/Bolajiomo99/E-Cinema/api/internal/reviews"
)

func TestReviews(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	p, err := db.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	if err := db.Migrate(ctx, p); err != nil {
		t.Fatal(err)
	}
	s := reviews.Store{DB: p}
	p.Exec(ctx, `DELETE FROM reviews WHERE showtime_id = 'review-test'`)
	p.Exec(ctx, `DELETE FROM holds WHERE showtime_id = 'review-test'`)
	p.Exec(ctx, `INSERT INTO showtimes VALUES ('review-test', 'F', 'S', now() + interval '1 hour', 90, 10, 500, 'USD') ON CONFLICT (id) DO UPDATE SET starts_at = EXCLUDED.starts_at`)
	var a, b string
	p.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash) VALUES ('review-a@example.com', 'Ada Obi', 'x') ON CONFLICT (email) DO UPDATE SET name = 'Ada Obi' RETURNING id`).Scan(&a)
	p.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash) VALUES ('review-b@example.com', 'Ben', 'x') ON CONFLICT (email) DO UPDATE SET name = 'Ben' RETURNING id`).Scan(&b)
	p.Exec(ctx, `INSERT INTO holds (showtime_id, seats, viewer_ref, status, expires_at, account_id) VALUES ('review-test', 1, 'r', 'paid', now(), $1)`, a)

	now := time.Now()
	if _, err := s.Save(ctx, b, "review-test", 4, nil, "", now.Add(2*time.Hour)); !errors.Is(err, reviews.ErrNotWatched) {
		t.Fatalf("no seat: %v", err)
	}
	if _, err := s.Save(ctx, a, "review-test", 4, nil, "", now); !errors.Is(err, reviews.ErrTooSoon) {
		t.Fatalf("before the film: %v", err)
	}
	if _, err := s.Save(ctx, a, "review-test", 6, nil, "", now.Add(2*time.Hour)); !errors.Is(err, reviews.ErrBadInput) {
		t.Fatalf("six stars: %v", err)
	}
	r, err := s.Save(ctx, a, "review-test", 4, []string{"great-story", "bogus", "great-story", "amazing-music"}, " Watched with\n40 friends ", now.Add(2*time.Hour))
	if err != nil || len(r.Tags) != 2 || r.Body != "Watched with 40 friends" {
		t.Fatalf("save = %+v, %v", r, err)
	}
	if _, err := s.Save(ctx, a, "review-test", 5, []string{"would-rewatch"}, "Again!", now.Add(2*time.Hour)); err != nil {
		t.Fatal(err)
	}
	mine, _ := s.Mine(ctx, a, "review-test")
	sum, err := s.Summarize(ctx, "review-test")
	if err != nil || mine.Stars != 5 || sum.Count != 1 || sum.Average != 5 || sum.Tags["would-rewatch"] != 1 || len(sum.Recent) != 1 || sum.Recent[0].Name != "Ada" {
		t.Fatalf("mine = %+v sum = %+v %v", mine, sum, err)
	}
	if none, _ := s.Mine(ctx, b, "review-test"); none != nil {
		t.Fatal("phantom review")
	}
}
