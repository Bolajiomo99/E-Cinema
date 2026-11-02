package httpapi

import (
	"net/http"
	"strings"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
	"github.com/Bolajiomo99/E-Cinema/api/internal/notify"
	"github.com/Bolajiomo99/E-Cinema/api/internal/parties"
)

func (s *Server) partyRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/parties", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b parties.New
		if !decode(w, r, &b) {
			return
		}
		p, err := s.Parties.Create(r.Context(), a.ID, b)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, p)
	}))
	// The party page works signed out too (name, film, host, head count); members see who is in.
	mux.HandleFunc("GET /v1/parties/{code}", s.internal(func(w http.ResponseWriter, r *http.Request) {
		viewer := ""
		if tok := r.Header.Get("X-Session-Token"); tok != "" {
			if a, _, err := s.Accounts.Authenticate(r.Context(), tok); err == nil {
				viewer = a.ID
			}
		}
		p, err := s.Parties.Get(r.Context(), r.PathValue("code"), viewer)
		if err != nil {
			fail(w, err)
			return
		}
		if !p.Joined {
			p.People = nil
		}
		writeJSON(w, http.StatusOK, p)
	}))
	// Live room types this viewer may use: kinds=party,private for watch parties, vr,ar for the VR cinema.
	mux.HandleFunc("GET /v1/me/rooms", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		kinds := strings.Split(r.URL.Query().Get("kinds"), ",")
		list, err := s.Parties.Rooms(r.Context(), a.ID, kinds...)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, list)
	}))
	mux.HandleFunc("GET /v1/me/parties", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		list, err := s.Parties.ForViewer(r.Context(), a.ID, 12)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, list)
	}))
	mux.HandleFunc("POST /v1/parties/{code}/join", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		p, err := s.Parties.Join(r.Context(), r.PathValue("code"), a.ID, a.Email)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, p)
	}))
	mux.HandleFunc("POST /v1/parties/{code}/leave", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		if err := s.Parties.Leave(r.Context(), r.PathValue("code"), a.ID); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("POST /v1/parties/{code}/invites", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct{ Emails []string }
		if !decode(w, r, &b) {
			return
		}
		p, err := s.Parties.Invite(r.Context(), r.PathValue("code"), a.ID, b.Emails)
		if err != nil {
			fail(w, err)
			return
		}
		s.notifyInvites(r, a.Name, p, b.Emails)
		writeJSON(w, http.StatusOK, p)
	}))
	mux.HandleFunc("DELETE /v1/parties/{code}", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		if err := s.Parties.End(r.Context(), r.PathValue("code"), a.ID); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
}

// notifyInvites tells invited viewers who already have an account.
func (s *Server) notifyInvites(r *http.Request, host string, p parties.Party, emails []string) {
	for _, e := range emails {
		_ = s.Notify.AddByEmail(r.Context(), e, notify.New{
			Kind:   "party",
			Title:  host + " invited you to a watch party",
			Body:   p.Film + " · " + p.StartsAt.UTC().Format("Mon 15:04") + " UTC",
			Link:   "/p/" + p.Code,
			Dedupe: "invite:" + p.Code,
		})
	}
}
