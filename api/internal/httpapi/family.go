package httpapi

import (
	"net/http"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
	"github.com/Bolajiomo99/E-Cinema/api/internal/notify"
)

// Family and kids (Figma 89:1020): profiles, parental controls, the parent PIN, screen time
// and kids' purchase requests. Changing a kids profile, or leaving one, needs the parent PIN.
func (s *Server) familyRoutes(mux *http.ServeMux) {
	type status struct {
		Profile accounts.Member `json:"profile"`
		Blocked string          `json:"blocked,omitempty"` // bedtime or screen-time
		Message string          `json:"message,omitempty"`
	}
	statusOf := func(p accounts.Member) status {
		st := status{Profile: p}
		if err := accounts.CanWatch(p, time.Now()); err != nil {
			st.Blocked, st.Message = "screen-time", err.Error()
			if err == accounts.ErrBedtime {
				st.Blocked = "bedtime"
			}
		}
		return st
	}
	mux.HandleFunc("GET /v1/me/family", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, sid string) {
		f, err := s.Accounts.Family(r.Context(), a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		active, err := s.Accounts.Active(r.Context(), a.ID, sid)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"family": f, "active": statusOf(active)})
	}))
	mux.HandleFunc("GET /v1/me/profile/active", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, sid string) {
		p, err := s.Accounts.Active(r.Context(), a.ID, sid)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, statusOf(p))
	}))
	mux.HandleFunc("POST /v1/me/profile/switch", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, sid string) {
		var b struct{ Profile, PIN string }
		if !decode(w, r, &b) {
			return
		}
		p, err := s.Accounts.Switch(r.Context(), a.ID, sid, b.Profile, b.PIN)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, statusOf(p))
	}))
	mux.HandleFunc("POST /v1/me/profile/watch", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, sid string) {
		var b struct{ Seconds int }
		if !decode(w, r, &b) {
			return
		}
		p, err := s.Accounts.Active(r.Context(), a.ID, sid)
		if err != nil {
			fail(w, err)
			return
		}
		if p.Kind != "owner" {
			if err := s.Accounts.AddWatch(r.Context(), p.ID, b.Seconds); err != nil {
				fail(w, err)
				return
			}
			p, _ = s.Accounts.ProfileFor(r.Context(), a.ID, p.ID)
		}
		writeJSON(w, http.StatusOK, statusOf(p))
	}))
	mux.HandleFunc("POST /v1/me/profile/ask", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, sid string) {
		var b struct{ What, Link string }
		if !decode(w, r, &b) {
			return
		}
		p, err := s.Accounts.Active(r.Context(), a.ID, sid)
		if err != nil {
			fail(w, err)
			return
		}
		req, err := s.Accounts.AskParent(r.Context(), a.ID, p.ID, b.What, b.Link)
		if err != nil {
			fail(w, err)
			return
		}
		// Email 17 (Figma 106:499): the grown-up decides from the family page.
		_ = s.Notify.Queue(r.Context(), notify.Mail{Kind: "kids_request", To: a.Email, Name: a.Name, Dedupe: "kidsreq:" + req.ID,
			Data: map[string]any{"profile": p.Name, "age": p.Age, "what": req.What, "request": req.ID}})
		writeJSON(w, http.StatusCreated, req)
	}))

	// Owner actions: refused from a kids profile, and kids changes need the PIN as well.
	grown := func(next func(http.ResponseWriter, *http.Request, accounts.Account, string)) http.HandlerFunc {
		return s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, sid string) {
			p, err := s.Accounts.Active(r.Context(), a.ID, sid)
			if err != nil {
				fail(w, err)
				return
			}
			if p.Kind == "kids" {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "Ask a parent to do this from their profile."})
				return
			}
			next(w, r, a, sid)
		})
	}
	mux.HandleFunc("POST /v1/me/family/pin", grown(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct{ Current, PIN string }
		if !decode(w, r, &b) {
			return
		}
		if err := s.Accounts.SetParentPIN(r.Context(), a.ID, b.Current, b.PIN); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	type profileBody struct {
		PIN     string          `json:"pin"`
		Profile accounts.Member `json:"profile"`
	}
	mux.HandleFunc("POST /v1/me/family/profiles", grown(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b profileBody
		if !decode(w, r, &b) {
			return
		}
		if b.Profile.Kind == "kids" {
			if err := s.Accounts.CheckParentPIN(r.Context(), a.ID, b.PIN); err != nil {
				fail(w, err)
				return
			}
		}
		p, err := s.Accounts.AddProfile(r.Context(), a.ID, b.Profile)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, p)
	}))
	mux.HandleFunc("PUT /v1/me/family/profiles/{id}", grown(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b profileBody
		if !decode(w, r, &b) {
			return
		}
		cur, err := s.Accounts.ProfileFor(r.Context(), a.ID, r.PathValue("id"))
		if err != nil {
			fail(w, err)
			return
		}
		if cur.Kind == "kids" || b.Profile.Kind == "kids" {
			if err := s.Accounts.CheckParentPIN(r.Context(), a.ID, b.PIN); err != nil {
				fail(w, err)
				return
			}
		}
		b.Profile.ID = cur.ID
		p, err := s.Accounts.UpdateProfile(r.Context(), a.ID, b.Profile)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, p)
	}))
	mux.HandleFunc("POST /v1/me/family/profiles/{id}/remove", grown(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct{ PIN string }
		if !decode(w, r, &b) {
			return
		}
		cur, err := s.Accounts.ProfileFor(r.Context(), a.ID, r.PathValue("id"))
		if err != nil || cur.Kind == "owner" {
			fail(w, accounts.ErrNotFound)
			return
		}
		if cur.Kind == "kids" {
			if err := s.Accounts.CheckParentPIN(r.Context(), a.ID, b.PIN); err != nil {
				fail(w, err)
				return
			}
		}
		if err := s.Accounts.RemoveProfile(r.Context(), a.ID, cur.ID); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("POST /v1/me/family/requests/{id}", grown(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct{ Approve bool }
		if !decode(w, r, &b) {
			return
		}
		if err := s.Accounts.DecideRequest(r.Context(), a.ID, r.PathValue("id"), b.Approve); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
}
