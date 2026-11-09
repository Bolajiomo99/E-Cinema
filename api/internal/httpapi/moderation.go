package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
	"github.com/Bolajiomo99/E-Cinema/api/internal/moderation"
)

// Automatic moderation: the web app's worker reads new public chat and posts and reports what
// Claude flagged (internal); the COO and CEO review the flags on Safety and trust.
func (s *Server) moderationRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/moderation/queue", s.internal(func(w http.ResponseWriter, r *http.Request) {
		items, upto, err := s.Moderation.Queue(r.Context())
		reply(w, map[string]any{"items": items, "upto": upto}, err)
	}))
	mux.HandleFunc("POST /v1/moderation/flags", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Verdicts []moderation.Verdict `json:"verdicts"`
			Upto     map[string]int64     `json:"upto"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10)).Decode(&b) != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad request"})
			return
		}
		hidden, err := s.Moderation.Flag(r.Context(), b.Verdicts, b.Upto)
		if errors.Is(err, moderation.ErrBadInput) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		if err == nil && s.Hub != nil {
			for _, h := range hidden {
				s.Hub.Takedown(h.Showtime, []int64{h.ID})
			}
		}
		reply(w, map[string]int{"hidden": len(hidden)}, err)
	}))
	on := s.execOnly
	mux.HandleFunc("GET /v1/me/exec/auto-flags", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		if err := s.Exec.CanModerate(r.Context(), a.Email); err != nil {
			fail(w, err)
			return
		}
		lagos := time.FixedZone("WAT", 3600)
		l := time.Now().In(lagos)
		flags, today, err := s.Moderation.Open(r.Context(), time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, lagos))
		reply(w, map[string]any{"flags": flags, "today": today, "hideAt": moderation.HideAt}, err)
	}))
	mux.HandleFunc("POST /v1/me/exec/auto-flags/{source}/{id}", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		if err := s.Exec.CanModerate(r.Context(), a.Email); err != nil {
			fail(w, err)
			return
		}
		var b struct {
			Remove bool `json:"remove"`
		}
		if !decode(w, r, &b) {
			return
		}
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad id"})
			return
		}
		showtime, err := s.Moderation.Review(r.Context(), r.PathValue("source"), id, b.Remove, a.Email)
		switch {
		case errors.Is(err, moderation.ErrNotFound):
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "That flag was already settled"})
			return
		case errors.Is(err, moderation.ErrBadInput):
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad source"})
			return
		}
		if err == nil && showtime != "" && s.Hub != nil {
			s.Hub.Takedown(showtime, []int64{id})
		}
		reply(w, map[string]bool{"hidden": b.Remove}, err)
	}))
}
