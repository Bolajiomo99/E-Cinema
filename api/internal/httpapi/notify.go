package httpapi

import (
	"net/http"
	"strconv"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
)

// Notifications (Figma 31:878).
func (s *Server) notifyRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/me/notifications", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		list, err := s.Notify.List(r.Context(), a.ID, r.URL.Query().Get("category"), time.Now())
		if err != nil {
			fail(w, err)
			return
		}
		n, err := s.Notify.Unread(r.Context(), a.ID, time.Now())
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"notifications": list, "unread": n})
	}))
	mux.HandleFunc("GET /v1/me/notifications/unread", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		n, err := s.Notify.Unread(r.Context(), a.ID, time.Now())
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]int{"unread": n})
	}))
	// id "all" marks everything read.
	mux.HandleFunc("POST /v1/me/notifications/{id}/read", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var id int64
		if v := r.PathValue("id"); v != "all" {
			n, err := strconv.ParseInt(v, 10, 64)
			if err != nil || n <= 0 {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad notification id"})
				return
			}
			id = n
		}
		if err := s.Notify.MarkRead(r.Context(), a.ID, id); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
}
