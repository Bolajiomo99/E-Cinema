package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"runtime/debug"
	"sync"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
	"github.com/Bolajiomo99/E-Cinema/api/internal/exec"
)

// Error alerts: the API's own failures (500s and panics) and the crashes the web app reports
// for viewers' browsers and its server go to exec.RecordError, which emails the tech team.

var release = os.Getenv("RENDER_GIT_COMMIT")

// errorSink records an API failure; set by Routes so fail() can reach the store.
var errorSink func(message, stack, path string)

// budget caps how many errors are written per minute, so a crash loop cannot flood the database.
type budget struct {
	mu    sync.Mutex
	start time.Time
	n     int
}

func (b *budget) take(now time.Time) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	if now.Sub(b.start) > time.Minute {
		b.start, b.n = now, 0
	}
	b.n++
	return b.n <= 60
}

func (s *Server) errorRoutes(mux *http.ServeMux) {
	var api, reported budget
	errorSink = func(message, stack, path string) {
		if !api.take(time.Now()) {
			return
		}
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if _, err := s.Exec.RecordError(ctx, exec.AppError{Source: "api", Message: message, Stack: stack, Path: path, Release: release}, time.Now()); err != nil {
				slog.Warn("could not record error", "err", err)
			}
		}()
	}
	// The web app forwards browser and server crashes here.
	mux.HandleFunc("POST /v1/errors", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var e exec.AppError
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&e); err != nil || (e.Source != "browser" && e.Source != "web") {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad error report"})
			return
		}
		if !reported.take(time.Now()) {
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		out, err := s.Exec.RecordError(r.Context(), e, time.Now())
		reply(w, map[string]string{"fingerprint": out.Fingerprint}, err)
	}))
	on := s.execOnly
	mux.HandleFunc("GET /v1/me/exec/errors", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		list, err := s.Exec.Errors(r.Context(), a.Email, time.Now())
		reply(w, map[string]any{"errors": list}, err)
	}))
	mux.HandleFunc("POST /v1/me/exec/errors/{fp}/resolve", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		err := s.Exec.ResolveError(r.Context(), a.Email, r.PathValue("fp"), time.Now())
		reply(w, map[string]bool{"resolved": err == nil}, err)
	}))
}

// recoverPanics turns a crashed handler into a 500 and an error alert instead of a dropped connection.
func recoverPanics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				if v == http.ErrAbortHandler {
					panic(v)
				}
				slog.Error("handler panic", "path", r.URL.Path, "panic", v)
				if errorSink != nil {
					errorSink(fmt.Sprintf("panic: %v", v), string(debug.Stack()), r.Method+" "+r.Pattern)
				}
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
			}
		}()
		next.ServeHTTP(w, r)
	})
}
