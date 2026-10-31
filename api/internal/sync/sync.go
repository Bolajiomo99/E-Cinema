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
	"time"

	"github.com/coder/websocket"
)

type Schedule interface {
	Start(ctx context.Context, showtimeID string) (start time.Time, durationMin int, err error)
}

type ping struct {
	ClientMs int64 `json:"c"`
}

type pong struct {
	ClientMs   int64  `json:"c"`
	ServerMs   int64  `json:"s"`
	PositionMs int64  `json:"p"`
	State      string `json:"state"` // waiting | playing | ended
}

func Handler(schedule Schedule, allowedOrigins []string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		start, durationMin, err := schedule.Start(r.Context(), r.PathValue("id"))
		if err != nil {
			http.Error(w, "unknown showtime", http.StatusNotFound)
			return
		}
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: allowedOrigins})
		if err != nil {
			return
		}
		defer conn.CloseNow()
		conn.SetReadLimit(256)
		end := start.Add(time.Duration(durationMin) * time.Minute)

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
			now := time.Now()
			out := pong{ClientMs: p.ClientMs, ServerMs: now.UnixMilli(), State: "playing"}
			switch {
			case now.Before(start):
				out.State, out.PositionMs = "waiting", 0
			case now.After(end):
				out.State, out.PositionMs = "ended", end.Sub(start).Milliseconds()
			default:
				out.PositionMs = now.Sub(start).Milliseconds()
			}
			b, _ := json.Marshal(out)
			if err := conn.Write(ctx, websocket.MessageText, b); err != nil {
				return
			}
		}
	}
}
