package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
	"github.com/Bolajiomo99/E-Cinema/api/internal/support"
)

// The support inbox. The web app opens requests and serves the private links (internal); members
// list their own; the support desk (staff, checked by the web app) answers them.
func (s *Server) supportRoutes(mux *http.ServeMux) {
	bad := func(w http.ResponseWriter, err error) bool {
		switch {
		case errors.Is(err, support.ErrBadInput), errors.Is(err, support.ErrClosed):
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		case errors.Is(err, support.ErrTooMany):
			writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": err.Error()})
		case errors.Is(err, support.ErrNotFound):
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "We could not find that request"})
		default:
			return false
		}
		return true
	}
	body := func(w http.ResponseWriter, r *http.Request, v any) bool {
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(v) != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad request"})
			return false
		}
		return true
	}
	mux.HandleFunc("POST /v1/support", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var n support.New
		if !body(w, r, &n) {
			return
		}
		req, err := s.Support.Open(r.Context(), n, time.Now())
		if bad(w, err) {
			return
		}
		reply(w, req, err)
	}))
	mux.HandleFunc("GET /v1/support/t/{token}", s.internal(func(w http.ResponseWriter, r *http.Request) {
		req, err := s.Support.ByToken(r.Context(), r.PathValue("token"))
		if bad(w, err) {
			return
		}
		reply(w, req, err)
	}))
	mux.HandleFunc("POST /v1/support/t/{token}/reply", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Body string `json:"body"`
		}
		if !body(w, r, &b) {
			return
		}
		req, err := s.Support.Reply(r.Context(), r.PathValue("token"), b.Body, time.Now())
		if bad(w, err) {
			return
		}
		reply(w, req, err)
	}))
	mux.HandleFunc("GET /v1/me/support", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		list, err := s.Support.Mine(r.Context(), a.ID)
		reply(w, map[string]any{"requests": list}, err)
	}))
	mux.HandleFunc("GET /v1/support/desk", s.internal(func(w http.ResponseWriter, r *http.Request) {
		status := r.URL.Query().Get("status")
		if status == "" {
			status = "open"
		}
		list, err := s.Support.Desk(r.Context(), status)
		if bad(w, err) {
			return
		}
		counts, waited, err2 := s.Support.Counts(r.Context(), time.Now())
		if err == nil {
			err = err2
		}
		reply(w, map[string]any{"requests": list, "counts": counts, "oldestMins": waited}, err)
	}))
	mux.HandleFunc("GET /v1/support/desk/{id}", s.internal(func(w http.ResponseWriter, r *http.Request) {
		id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
		req, err := s.Support.Thread(r.Context(), id)
		if bad(w, err) {
			return
		}
		reply(w, req, err)
	}))
	mux.HandleFunc("POST /v1/support/desk/{id}", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Staff string `json:"staff"`
			Body  string `json:"body"`
			Close bool   `json:"close"`
		}
		if !body(w, r, &b) {
			return
		}
		id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
		req, err := s.Support.Answer(r.Context(), id, b.Staff, b.Body, b.Close, time.Now())
		if bad(w, err) {
			return
		}
		reply(w, req, err)
	}))
}
