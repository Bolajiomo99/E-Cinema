package insights_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/db"
	"github.com/Bolajiomo99/E-Cinema/api/internal/insights"
)

func TestInsights(t *testing.T) {
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
	s := insights.Store{DB: p}
	p.Exec(ctx, `INSERT INTO showtimes VALUES ('ins-film', 'Insight Film', 'S', now() - interval '2 days', 90, 10, 500, 'USD') ON CONFLICT (id) DO UPDATE SET starts_at = EXCLUDED.starts_at`)
	var a, b string
	p.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash) VALUES ('ins-a@example.com', 'Ada', 'x') ON CONFLICT (email) DO UPDATE SET name = 'Ada' RETURNING id`).Scan(&a)
	p.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash) VALUES ('ins-b@example.com', 'Ben', 'x') ON CONFLICT (email) DO UPDATE SET name = 'Ben' RETURNING id`).Scan(&b)
	p.Exec(ctx, `DELETE FROM watch_beats WHERE account_id = $1`, a)
	p.Exec(ctx, `DELETE FROM watch_last WHERE account_id = $1`, a)
	p.Exec(ctx, `DELETE FROM room_messages WHERE showtime_id = 'ins-film'`)
	p.Exec(ctx, `DELETE FROM holds WHERE showtime_id = 'ins-film'`)
	now := time.Now()
	if _, err := s.Record(ctx, a, "ins-film", "cinema", "", "", 60, now); !errors.Is(err, insights.ErrBadInput) {
		t.Fatalf("bad mode: %v", err)
	}
	if ok, err := s.Record(ctx, a, "ins-film", "room", "yo", "", 600, now); err != nil || !ok {
		t.Fatalf("beat: %v %v", ok, err)
	}
	if ok, _ := s.Record(ctx, a, "ins-film", "room", "yo", "", 60, now.Add(10*time.Second)); ok {
		t.Fatal("beat too soon counted")
	}
	if ok, _ := s.Record(ctx, a, "no-such-film", "room", "", "", 60, now.Add(time.Minute)); ok {
		t.Fatal("unknown film counted")
	}
	s.Record(ctx, a, "ins-film", "replay", "", "fr", 60, now.Add(2*time.Minute))
	p.Exec(ctx, `INSERT INTO holds (showtime_id, seats, viewer_ref, status, expires_at, account_id, paypal_capture_id) VALUES ('ins-film', 2, 'r', 'paid', now(), $1, 'INS-CAP-'||extract(epoch from now())::text)`, a)
	p.Exec(ctx, `INSERT INTO room_messages (showtime_id, account_id, name, body) VALUES ('ins-film', $1, 'Ada', 'hi')`, a)
	p.Exec(ctx, `INSERT INTO room_messages (showtime_id, account_id, name, body, country) VALUES ('ins-film', $1, 'Ben', 'hello', 'GH'), ('ins-film', $1, 'Ben', 'again', 'GH')`, b)

	from := now.Add(-7 * 24 * time.Hour)
	r, err := s.Report(ctx, a, from, now.Add(time.Hour), now)
	if err != nil {
		t.Fatal(err)
	}
	c := r.Current
	// The minute cap holds even though the first beat claimed ten minutes.
	if c.Seconds != 120 || c.Premieres != 1 || c.Messages != 1 || c.Countries != 1 || c.Spent["USD"] < 1000 {
		t.Fatalf("totals = %+v", c)
	}
	if len(r.Months) != 6 || r.Months[5].Seconds < 120 || len(r.Films) != 1 || len(r.Chats) != 1 || r.Chats[0].Country != "GH" || r.Chats[0].Messages != 2 {
		t.Fatalf("report = %+v", r)
	}
	var yo, fr bool
	for _, l := range r.Languages {
		yo = yo || (l.Lang == "yo" && l.Kind == "audio" && l.Seconds == 60)
		fr = fr || (l.Lang == "fr" && l.Kind == "subs")
	}
	if !yo || !fr {
		t.Fatalf("languages = %+v", r.Languages)
	}
}
