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
		country := ""
		if p, err := s.Accounts.GetProfile(r.Context(), a.ID); err == nil {
			country = p.Country
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"pass":      s.Passes.Issue(rooms.Pass{AccountID: a.ID, ShowtimeID: id, Name: name, Expires: exp, Country: country}),
			"expiresAt": exp.UTC(),
		})
	}))
	// Before refunding on PayPal, the web app checks the seat is the viewer's own and still cancellable.
	mux.HandleFunc("POST /v1/me/holds/{id}/cancel", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		c, err := s.Tickets.CanCancel(r.Context(), a.ID, r.PathValue("id"))
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, c)
	}))
	// The viewer's own seats: paid tickets and holds waiting for PayPal approval.
	mux.HandleFunc("GET /v1/me/tickets", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		list, err := s.Tickets.Mine(r.Context(), a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, list)
	}))
	mux.HandleFunc("DELETE /v1/me/holds/{id}", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		if err := s.Tickets.ReleaseMine(r.Context(), a.ID, r.PathValue("id")); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	// Public audience numbers for the "N watching · N countries" badges. Counts only, no people.
	mux.HandleFunc("GET /v1/live", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=5")
		writeJSON(w, http.StatusOK, s.Hub.Stats())
	})
	// Paid seats for the next 24 hours by home country, for the world map's "Tonight" view.
	mux.HandleFunc("GET /v1/audience/tonight", func(w http.ResponseWriter, r *http.Request) {
		list, err := s.Tickets.Tonight(r.Context())
		if err != nil {
			fail(w, err)
			return
		}
		w.Header().Set("Cache-Control", "public, max-age=30")
		writeJSON(w, http.StatusOK, list)
	})
	mux.Handle("GET /v1/rooms/{id}/live", s.Hub.Live(s.Rooms, s.Passes, s.AllowedOrigins))
}
