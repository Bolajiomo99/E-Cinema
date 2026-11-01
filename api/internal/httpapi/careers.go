package httpapi

import (
	"net/http"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
	"github.com/Bolajiomo99/E-Cinema/api/internal/careers"
)

// Careers (Figma 94:1157, 114:1273, 114:1397, 114:1531) and group screening quotes (94:1239).
func (s *Server) careersRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/jobs", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		b, err := s.Careers.Open(r.Context(), careers.Filter{Q: q.Get("q"), Country: q.Get("country"), Team: q.Get("team"), Quota: q.Get("quota"), Kind: q.Get("kind")})
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, b)
	})
	mux.HandleFunc("GET /v1/jobs/{slug}", func(w http.ResponseWriter, r *http.Request) {
		j, err := s.Careers.Job(r.Context(), r.PathValue("slug"))
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, j)
	})
	mux.HandleFunc("GET /v1/me/jobs/{slug}", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		app, err := s.Careers.Applied(r.Context(), a.ID, r.PathValue("slug"))
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"application": app})
	}))
	mux.HandleFunc("POST /v1/me/jobs/{slug}/apply", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b careers.Applying
		if !decode(w, r, &b) {
			return
		}
		app, err := s.Careers.Apply(r.Context(), a.ID, r.PathValue("slug"), b)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, app)
	}))
	mux.HandleFunc("GET /v1/me/applications", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		list, err := s.Careers.Mine(r.Context(), a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"applications": list})
	}))
	mux.HandleFunc("POST /v1/me/applications/{id}/withdraw", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		if err := s.Careers.Withdraw(r.Context(), a.ID, r.PathValue("id")); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	// The hiring desk (web staff page).
	mux.HandleFunc("GET /v1/careers/jobs", s.internal(func(w http.ResponseWriter, r *http.Request) {
		list, err := s.Careers.AllJobs(r.Context())
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"jobs": list})
	}))
	mux.HandleFunc("PUT /v1/careers/jobs/{slug}", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var j careers.Job
		if !decode(w, r, &j) {
			return
		}
		j.Slug = r.PathValue("slug")
		saved, err := s.Careers.SaveJob(r.Context(), j)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, saved)
	}))
	mux.HandleFunc("PUT /v1/careers/share", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			NGShare int `json:"ngShare"`
		}
		if !decode(w, r, &b) {
			return
		}
		if err := s.Careers.SetShare(r.Context(), b.NGShare); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("GET /v1/careers/applications", s.internal(func(w http.ResponseWriter, r *http.Request) {
		list, err := s.Careers.Pipeline(r.Context(), r.URL.Query().Get("job"))
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"applications": list})
	}))
	mux.HandleFunc("GET /v1/careers/applications/{id}", s.internal(func(w http.ResponseWriter, r *http.Request) {
		app, err := s.Careers.Get(r.Context(), r.PathValue("id"))
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, app)
	}))
	mux.HandleFunc("POST /v1/careers/applications/{id}", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var m careers.Move
		if !decode(w, r, &m) {
			return
		}
		app, err := s.Careers.Advance(r.Context(), r.PathValue("id"), m)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, app)
	}))

	mux.HandleFunc("POST /v1/business/quotes", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var q careers.Quote
		if !decode(w, r, &q) {
			return
		}
		saved, err := s.Careers.AskQuote(r.Context(), q)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, saved)
	}))
	mux.HandleFunc("GET /v1/business/quotes", s.internal(func(w http.ResponseWriter, r *http.Request) {
		list, err := s.Careers.Quotes(r.Context())
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"quotes": list})
	}))
	mux.HandleFunc("POST /v1/business/quotes/{id}", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Status string `json:"status"`
		}
		if !decode(w, r, &b) {
			return
		}
		if err := s.Careers.SetQuote(r.Context(), r.PathValue("id"), b.Status); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
}
