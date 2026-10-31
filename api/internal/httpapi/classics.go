package httpapi

import (
	"net/http"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
)

func (s *Server) classicRoutes(mux *http.ServeMux) {
	// Public list with request counts; a signed-in viewer also sees which ones they asked for.
	mux.HandleFunc("GET /v1/classics", s.internal(func(w http.ResponseWriter, r *http.Request) {
		viewer := ""
		if tok := r.Header.Get("X-Session-Token"); tok != "" {
			if a, _, err := s.Accounts.Authenticate(r.Context(), tok); err == nil {
				viewer = a.ID
			}
		}
		list, err := s.Classics.List(r.Context(), viewer)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, list)
	}))
	activePlan := func(r *http.Request, a accounts.Account) string {
		p, err := s.Accounts.GetProfile(r.Context(), a.ID)
		if err != nil || p.PlanStatus != "active" {
			return ""
		}
		return p.Plan
	}
	mux.HandleFunc("POST /v1/classics/{id}/vote", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		if err := s.Classics.Vote(r.Context(), r.PathValue("id"), a.ID, activePlan(r, a)); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("DELETE /v1/classics/{id}/vote", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		if err := s.Classics.Unvote(r.Context(), r.PathValue("id"), a.ID); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("POST /v1/classics", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct {
			Title string `json:"title"`
			Year  int    `json:"year"`
		}
		if !decode(w, r, &b) {
			return
		}
		id, err := s.Classics.Suggest(r.Context(), a.ID, activePlan(r, a), b.Title, b.Year)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]string{"id": id})
	}))
}
