package playback_test

import (
	"context"
	"errors"
	"math"
	"os"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/db"
	"github.com/Bolajiomo99/E-Cinema/api/internal/playback"
)

func TestPlayback(t *testing.T) {
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
	s := playback.Store{DB: p}
	start := time.Now().Add(-30 * time.Minute).Truncate(time.Minute)
	p.Exec(ctx, `DELETE FROM showtimes WHERE id = 'pb-film'`)
	p.Exec(ctx, `INSERT INTO showtimes (id, film, studio, starts_at, duration_min, capacity, price_cents, currency) VALUES ('pb-film', 'Playback Film', 'PB Studio', $1, 100, 10, 500, 'USD')`, start)
	t.Cleanup(func() { p.Exec(ctx, `DELETE FROM showtimes WHERE id = 'pb-film'`) })
	var a, b string
	p.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash, country) VALUES ('pb-a@example.com', 'Ada', 'x', 'NG') ON CONFLICT (email) DO UPDATE SET country = 'NG' RETURNING id`).Scan(&a)
	p.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash, country) VALUES ('pb-b@example.com', 'Ben', 'x', 'GH') ON CONFLICT (email) DO UPDATE SET country = 'GH' RETURNING id`).Scan(&b)

	if err := s.Record(ctx, a, "pb-film", "room", playback.Report{Device: "fridge"}, start); !errors.Is(err, playback.ErrBadInput) {
		t.Fatalf("bad device: %v", err)
	}
	if err := s.Record(ctx, a, "pb-film", "room", playback.Report{}, start); err != nil {
		t.Fatalf("old player report should be ignored: %v", err)
	}
	now := start.Add(10 * time.Minute)
	// Ada: in sync, fast start, watched 80 of 100 minutes. Ben: drifting, stalled, left at 10.
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(s.Record(ctx, a, "pb-film", "room", playback.Report{Position: 600, DriftMs: 80, StartMs: 1200, Device: "android", Hour: 20, Dow: 4}, now))
	must(s.Record(ctx, a, "pb-film", "room", playback.Report{Position: 4800, DriftMs: 120, Device: "android", Hour: 21, Dow: 4}, now.Add(time.Minute)))
	must(s.Record(ctx, b, "pb-film", "room", playback.Report{Position: 600, DriftMs: 900, StallMs: 6000, Stalls: 2, StartMs: 3200, Device: "web", Hour: 19, Dow: 4}, now))

	q, err := s.Of(ctx, "pb-film", start)
	if err != nil {
		t.Fatal(err)
	}
	if q.Reports != 3 || q.InSync == nil || math.Abs(*q.InSync-2.0/3) > 1e-9 || *q.DriftMs != (80+120+900)/3 || *q.StartMs != 2200 {
		t.Fatalf("quality = %+v", q)
	}
	if math.Abs(*q.Rebuffer-6000.0/180000) > 1e-9 || q.Countries["GH"].DriftMs != 900 || q.Countries["NG"].Reports != 2 {
		t.Fatalf("rebuffer/countries = %v %+v", *q.Rebuffer, q.Countries)
	}
	empty, _ := s.Of(ctx, "pb-film", now.Add(time.Hour))
	if empty.Reports != 0 || empty.InSync != nil || empty.StartMs != nil {
		t.Fatalf("empty = %+v", empty)
	}

	au, err := s.AudienceOf(ctx, "PB Studio", start.Add(-time.Hour), start.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if au.Viewers != 2 || au.Retention[0] != 1 || au.Retention[2] != 1 || au.Retention[3] != 0.5 || au.Retention[16] != 0.5 || au.Retention[17] != 0 {
		t.Fatalf("retention = %v (viewers %d)", au.Retention, au.Viewers)
	}
	if au.Devices["android"] != 1 || au.Devices["web"] != 1 || au.Hours[4][20] != 1 || au.Hours[4][19] != 1 {
		t.Fatalf("devices/hours = %v %v", au.Devices, au.Hours[4])
	}
}
