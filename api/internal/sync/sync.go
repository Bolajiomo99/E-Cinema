// Package sync keeps every player in a premiere on the same frame.
//
// The client sends its own clock reading; the server answers with that reading, its own
// clock and where the premiere should be right now. The client works out its clock offset
// from the round trip (NTP style) and seeks when it drifts more than a few hundred ms.
package sync

import (
	"context"
	"encoding/json"
	"net/http"
	gosync "sync"
	"time"

	"github.com/coder/websocket"
)

// Timing is where a screening stands: when it started, how long it runs (pauses included) and
// any emergency pause the studio has on (Studio / Live control room).
type Timing struct {
	Start       time.Time
	DurationMin int
	PausedAt    *time.Time
	PausedMs    int64
}

type Schedule interface {
	Timing(ctx context.Context, showtimeID string) (Timing, error)
}

type ping struct {
	ClientMs int64 `json:"c"`
}

type pong struct {
	ClientMs   int64  `json:"c"`
	ServerMs   int64  `json:"s"`
	PositionMs int64  `json:"p"`
	PausedMs   int64  `json:"o"`     // time spent paused, so position = now - start - o
	State      string `json:"state"` // waiting | playing | paused | ended
}

// Pong works out what one player should be showing at now.
func position(t Timing, now time.Time, clientMs int64) pong {
	out := pong{ClientMs: clientMs, ServerMs: now.UnixMilli(), State: "playing", PausedMs: t.PausedMs}
	if t.PausedAt != nil && !now.Before(*t.PausedAt) {
		out.PausedMs += now.Sub(*t.PausedAt).Milliseconds()
		out.State = "paused"
	}
	end := t.Start.Add(time.Duration(t.DurationMin) * time.Minute)
	pos := now.Sub(t.Start).Milliseconds() - out.PausedMs
	switch {
	case now.Before(t.Start):
		out.State, out.PositionMs = "waiting", 0
	case out.State != "paused" && now.After(end):
		out.State, out.PositionMs = "ended", end.Sub(t.Start).Milliseconds()-out.PausedMs
	default:
		out.PositionMs = pos
	}
	return out
}

// cached reads a screening's timing at most once every two seconds, however many players ask.
type cached struct {
	s  Schedule
	mu gosync.Mutex
	m  map[string]entry
}

type entry struct {
	t   Timing
	err error
	at  time.Time
}

func (c *cached) get(ctx context.Context, id string) (Timing, error) {
	c.mu.Lock()
	e, ok := c.m[id]
	c.mu.Unlock()
	if ok && time.Since(e.at) < 2*time.Second {
		return e.t, e.err
	}
	t, err := c.s.Timing(ctx, id)
	c.mu.Lock()
	if len(c.m) > 10000 {
		c.m = map[string]entry{}
	}
	c.m[id] = entry{t, err, time.Now()}
	c.mu.Unlock()
	return t, err
}

func Handler(schedule Schedule, allowedOrigins []string) http.HandlerFunc {
	cache := &cached{s: schedule, m: map[string]entry{}}
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if _, err := schedule.Timing(r.Context(), id); err != nil {
			http.Error(w, "unknown showtime", http.StatusNotFound)
			return
		}
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: allowedOrigins})
		if err != nil {
			return
		}
		defer conn.CloseNow()
		conn.SetReadLimit(256)

		ctx := r.Context()
		for {
			ctxRead, cancel := context.WithTimeout(ctx, 2*time.Minute)
			_, data, err := conn.Read(ctxRead)
			cancel()
			if err != nil {
				return
			}
			var p ping
			if json.Unmarshal(data, &p) != nil {
				continue
			}
			t, err := cache.get(ctx, id)
			if err != nil {
				return
			}
			b, _ := json.Marshal(position(t, time.Now(), p.ClientMs))
			if err := conn.Write(ctx, websocket.MessageText, b); err != nil {
				return
			}
		}
	}
}
