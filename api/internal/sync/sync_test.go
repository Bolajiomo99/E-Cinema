package sync

import (
	"testing"
	"time"
)

func TestPosition(t *testing.T) {
	start := time.Date(2026, 11, 7, 18, 0, 0, 0, time.UTC)
	tm := Timing{Start: start, DurationMin: 100}
	if p := position(tm, start.Add(-time.Minute), 1); p.State != "waiting" || p.PositionMs != 0 {
		t.Fatalf("before: %+v", p)
	}
	if p := position(tm, start.Add(10*time.Minute), 1); p.State != "playing" || p.PositionMs != 600000 {
		t.Fatalf("playing: %+v", p)
	}
	at := start.Add(10 * time.Minute)
	tm.PausedAt = &at
	if p := position(tm, start.Add(15*time.Minute), 1); p.State != "paused" || p.PositionMs != 600000 || p.PausedMs != 300000 {
		t.Fatalf("paused: %+v", p)
	}
	// Paused past the old end: still paused, not ended.
	if p := position(tm, start.Add(200*time.Minute), 1); p.State != "paused" || p.PositionMs != 600000 {
		t.Fatalf("long pause: %+v", p)
	}
	// Resumed after 5 minutes: the running time grew by 5 and everyone picks up at 10:00.
	tm = Timing{Start: start, DurationMin: 105, PausedMs: 300000}
	if p := position(tm, start.Add(16*time.Minute), 1); p.State != "playing" || p.PositionMs != 660000 || p.PausedMs != 300000 {
		t.Fatalf("resumed: %+v", p)
	}
	if p := position(tm, start.Add(106*time.Minute), 1); p.State != "ended" || p.PositionMs != 100*60000 {
		t.Fatalf("ended: %+v", p)
	}
}
