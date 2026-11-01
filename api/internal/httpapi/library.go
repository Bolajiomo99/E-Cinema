package httpapi

import (
	"net/http"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
	"github.com/Bolajiomo99/E-Cinema/api/internal/library"
)

// Library routes (Figma 19:583, 101:1208, 101:1387).
func (s *Server) libraryRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/me/library", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		ctx := r.Context()
		items, err := s.Library.Items(ctx, a.ID, time.Now())
		if err != nil {
			fail(w, err)
			return
		}
		req, err := s.Library.Requested(ctx, a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		cols, err := s.Library.Collections(ctx, a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items, "requested": req, "collections": cols})
	}))
	mux.HandleFunc("GET /v1/me/library/{showtime}", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		it, err := s.Library.Access(r.Context(), a.ID, r.PathValue("showtime"), time.Now())
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, it)
	}))
	mux.HandleFunc("POST /v1/me/library/{showtime}/keep", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct {
			Quality     string `json:"quality"`
			OrderID     string `json:"orderId"`
			AmountCents int    `json:"amountCents"`
			Currency    string `json:"currency"`
		}
		if !decode(w, r, &b) {
			return
		}
		if err := s.Library.AttachKeep(r.Context(), a.ID, r.PathValue("showtime"), b.Quality, b.OrderID, b.AmountCents, b.Currency); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("POST /v1/me/collections", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct {
			Name string `json:"name"`
			Kids bool   `json:"kids"`
		}
		if !decode(w, r, &b) {
			return
		}
		c, err := s.Library.CreateCollection(r.Context(), a.ID, b.Name, b.Kids)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, c)
	}))
	mux.HandleFunc("PUT /v1/me/collections/{id}", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct {
			Name string `json:"name"`
			Kids bool   `json:"kids"`
		}
		if !decode(w, r, &b) {
			return
		}
		if err := s.Library.UpdateCollection(r.Context(), a.ID, r.PathValue("id"), b.Name, b.Kids); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("DELETE /v1/me/collections/{id}", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		err := s.Library.DeleteCollection(r.Context(), a.ID, r.PathValue("id"))
		if err == library.ErrNotOwner {
			// A friend removing a shared collection from their own Library.
			err = s.Library.Leave(r.Context(), a.ID, r.PathValue("id"))
		}
		if err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("PUT /v1/me/collections/{id}/films/{showtime}", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		if err := s.Library.SetFilm(r.Context(), a.ID, r.PathValue("id"), r.PathValue("showtime"), true); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("DELETE /v1/me/collections/{id}/films/{showtime}", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		if err := s.Library.SetFilm(r.Context(), a.ID, r.PathValue("id"), r.PathValue("showtime"), false); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("POST /v1/me/collections/{id}/shares", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct {
			Email string `json:"email"`
		}
		if !decode(w, r, &b) {
			return
		}
		name, err := s.Library.Share(r.Context(), a.ID, r.PathValue("id"), b.Email)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"name": name})
	}))
}

func (s *Server) rewatchRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/me/rewatch", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct {
			ShowtimeID string    `json:"showtimeId"`
			StartsAt   time.Time `json:"startsAt"`
		}
		if !decode(w, r, &b) {
			return
		}
		p, err := s.Library.StartRewatch(r.Context(), a.ID, b.ShowtimeID, b.StartsAt, time.Now())
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, p)
	}))
	mux.HandleFunc("GET /v1/me/rewatch/{code}", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		p, err := s.Library.GetRewatch(r.Context(), a.ID, r.PathValue("code"), time.Now())
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, p)
	}))
}
