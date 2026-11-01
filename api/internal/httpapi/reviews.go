package httpapi

import (
	"net/http"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
)

func (s *Server) reviewRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/me/reviews/{showtime}", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		mine, err := s.Reviews.Mine(r.Context(), a.ID, r.PathValue("showtime"))
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"review": mine})
	}))
	mux.HandleFunc("PUT /v1/me/reviews/{showtime}", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct {
			Stars int      `json:"stars"`
			Tags  []string `json:"tags"`
			Body  string   `json:"body"`
		}
		if !decode(w, r, &b) {
			return
		}
		rev, err := s.Reviews.Save(r.Context(), a.ID, r.PathValue("showtime"), b.Stars, b.Tags, b.Body, time.Now())
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, rev)
	}))
	mux.HandleFunc("GET /v1/showtimes/{id}/reviews", func(w http.ResponseWriter, r *http.Request) {
		sum, err := s.Reviews.Summarize(r.Context(), r.PathValue("id"))
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, sum)
	})
}
