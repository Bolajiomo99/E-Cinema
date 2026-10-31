package httpapi

import (
	"net/http"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
	"github.com/Bolajiomo99/E-Cinema/api/internal/rooms"
)

func (s *Server) roomRoutes(mux *http.ServeMux) {
	// Everything the room page needs in one call: the screening, whether the viewer may
	// enter, their watermark code and the chat so far.
	mux.HandleFunc("GET /v1/rooms/{id}", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		id := r.PathValue("id")
		st, err := s.Tickets.Get(r.Context(), id)
		if err != nil {
			fail(w, err)
			return
		}
		ok, err := s.Tickets.HasTicket(r.Context(), id, a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		out := map[string]any{"showtime": st, "hasTicket": ok, "serverTime": time.Now().UTC()}
		if ok {
			msgs, err := s.Rooms.Recent(r.Context(), id, a.ID, 50)
			if err != nil {
				fail(w, err)
				return
			}
			out["messages"] = msgs
			out["viewerCode"] = rooms.ViewerCode(s.Passes.Key, a.ID)
			out["watching"] = s.Hub.Count(id)
		}
		writeJSON(w, http.StatusOK, out)
	}))
	mux.HandleFunc("POST /v1/rooms/{id}/pass", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		id := r.PathValue("id")
		ok, err := s.Tickets.HasTicket(r.Context(), id, a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		if !ok {
			fail(w, rooms.ErrNoTicket)
			return
		}
		name := a.Name
		if name == "" {
			name = "Guest"
		}
		exp := time.Now().Add(rooms.PassFor)
		writeJSON(w, http.StatusOK, map[string]any{
			"pass":      s.Passes.Issue(rooms.Pass{AccountID: a.ID, ShowtimeID: id, Name: name, Expires: exp}),
			"expiresAt": exp.UTC(),
		})
	}))
	mux.Handle("GET /v1/rooms/{id}/live", s.Hub.Live(s.Rooms, s.Passes, s.AllowedOrigins))
}
