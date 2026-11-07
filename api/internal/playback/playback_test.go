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

func TestView(t *testing.T) {
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
	p.Exec(ctx, `DELETE FROM showtimes WHERE id = 'pv-film'`)
	p.Exec(ctx, `INSERT INTO showtimes (id, film, studio, starts_at, duration_min, capacity, price_cents, currency) VALUES ('pv-film', 'View Film', 'PV Studio', now() + interval '2 days', 100, 10, 500, 'USD')`)
	t.Cleanup(func() { p.Exec(ctx, `DELETE FROM showtimes WHERE id = 'pv-film'`) })
	now := time.Date(2026, 11, 7, 10, 0, 0, 0, time.UTC)
	v := "0123456789abcdef"
	for _, c := range []struct{ film, kind, visitor string }{{"pv-film", "like", v}, {"pv-film", "page", "Not-A-Hash"}, {"", "page", v}} {
		if _, err := s.View(ctx, c.film, c.kind, c.visitor, "NG", now); !errors.Is(err, playback.ErrBadInput) {
			t.Fatalf("%+v: want ErrBadInput, got %v", c, err)
		}
	}
	if ok, err := s.View(ctx, "pv-film", "page", v, "NG", now); err != nil || !ok {
		t.Fatalf("first view: %v %v", ok, err)
	}
	if ok, _ := s.View(ctx, "pv-film", "page", v, "NG", now.Add(time.Hour)); ok {
		t.Fatal("same visitor, same day counted twice")
	}
	if ok, _ := s.View(ctx, "pv-film", "page", v, "NG", now.Add(24*time.Hour)); !ok {
		t.Fatal("next day not counted")
	}
	if ok, _ := s.View(ctx, "pv-film", "clip", v, "zz", now); !ok {
		t.Fatal("clip not counted")
	}
	if ok, err := s.View(ctx, "no-such-film", "page", v, "", now); err != nil || ok {
		t.Fatalf("unknown film: %v %v", ok, err)
	}
	var n int
	var country *string
	p.QueryRow(ctx, `SELECT count(*), max(country) FILTER (WHERE kind = 'clip') FROM page_views WHERE showtime_id = 'pv-film'`).Scan(&n, &country)
	if n != 3 || country != nil {
		t.Fatalf("rows %d, clip country %v", n, country)
	}
}
