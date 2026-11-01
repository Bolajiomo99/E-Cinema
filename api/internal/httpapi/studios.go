package httpapi

import (
	"net/http"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
	"github.com/Bolajiomo99/E-Cinema/api/internal/studios"
)

// The studio portal (Figma "06 Studio Portal"): onboarding, team, overview, films and payouts.
func (s *Server) studioRoutes(mux *http.ServeMux) {
	type mine = func(w http.ResponseWriter, r *http.Request, a accounts.Account)
	on := func(fn mine) http.HandlerFunc {
		return s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) { fn(w, r, a) })
	}
	withSteps := func(w http.ResponseWriter, st studios.Studio, err error) {
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"studio": st, "steps": st.Steps(), "identityOk": true})
	}

	mux.HandleFunc("GET /v1/me/studio", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		st, err := s.Studios.Mine(r.Context(), a.ID, a.Email)
		if err == studios.ErrNotFound {
			writeJSON(w, http.StatusOK, map[string]any{"studio": nil})
			return
		}
		withSteps(w, st, err)
	}))
	mux.HandleFunc("PUT /v1/me/studio", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var d studios.Draft
		if decodeN(w, r, 4<<10, &d) {
			st, err := s.Studios.Save(r.Context(), a.ID, a.Email, d)
			withSteps(w, st, err)
		}
	}))
	mux.HandleFunc("PUT /v1/me/studio/docs", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b struct {
			Key string
			OK  bool
		}
		if decodeN(w, r, 2<<10, &b) {
			st, err := s.Studios.SetDocs(r.Context(), a.ID, a.Email, b.Key, b.OK)
			withSteps(w, st, err)
		}
	}))
	mux.HandleFunc("PUT /v1/me/studio/payout", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var p studios.Payout
		if decodeN(w, r, 2<<10, &p) {
			st, err := s.Studios.SetPayout(r.Context(), a.ID, a.Email, p)
			withSteps(w, st, err)
		}
	}))
	mux.HandleFunc("PUT /v1/me/studio/rights", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b struct{ Note string }
		if decodeN(w, r, 8<<10, &b) {
			st, err := s.Studios.DeclareRights(r.Context(), a.ID, a.Email, b.Note)
			withSteps(w, st, err)
		}
	}))
	mux.HandleFunc("POST /v1/me/studio/terms", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		st, err := s.Studios.AcceptTerms(r.Context(), a.ID, a.Email)
		withSteps(w, st, err)
	}))
	mux.HandleFunc("POST /v1/me/studio/submit", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		if !a.IDVerified || !a.FaceVerified {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "Verify your face and ID first, so we know who runs this studio"})
			return
		}
		st, err := s.Studios.Submit(r.Context(), a.ID, a.Email)
		withSteps(w, st, err)
	}))

	mux.HandleFunc("GET /v1/me/studio/overview", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		o, err := s.Studios.Overview(r.Context(), a.ID, a.Email, time.Now())
		reply(w, o, err)
	}))
	mux.HandleFunc("GET /v1/me/studio/films", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		f, err := s.Studios.Films(r.Context(), a.ID, a.Email)
		reply(w, map[string]any{"films": f}, err)
	}))
	mux.HandleFunc("GET /v1/me/studio/payouts", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		st, p, err := s.Studios.Payouts(r.Context(), a.ID, a.Email)
		reply(w, map[string]any{"studio": st, "payouts": p}, err)
	}))
	mux.HandleFunc("GET /v1/me/studio/team", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		t, err := s.Studios.Team(r.Context(), a.ID, a.Email)
		reply(w, map[string]any{"members": t, "roles": studios.Roles}, err)
	}))
	mux.HandleFunc("PUT /v1/me/studio/team", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b struct{ Email, Role string }
		if decodeN(w, r, 1<<10, &b) {
			err := s.Studios.SetMember(r.Context(), a.ID, a.Email, b.Email, b.Role)
			if err == nil {
				t, err2 := s.Studios.Team(r.Context(), a.ID, a.Email)
				reply(w, map[string]any{"members": t, "roles": studios.Roles}, err2)
				return
			}
			fail(w, err)
		}
	}))
	mux.HandleFunc("POST /v1/me/studio/team/remove", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b struct{ Email string }
		if decodeN(w, r, 1<<10, &b) {
			if err := s.Studios.RemoveMember(r.Context(), a.ID, a.Email, b.Email); err != nil {
				fail(w, err)
				return
			}
			t, err := s.Studios.Team(r.Context(), a.ID, a.Email)
			reply(w, map[string]any{"members": t, "roles": studios.Roles}, err)
		}
	}))

	// The studio desk, for E-Cinema staff (the web checks STAFF_EMAILS).
	mux.HandleFunc("GET /v1/studios/applications", s.internal(func(w http.ResponseWriter, r *http.Request) {
		a, err := s.Studios.Applications(r.Context())
		reply(w, map[string]any{"studios": a}, err)
	}))
	mux.HandleFunc("POST /v1/studios/{slug}/review", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Approve bool
			Note    string
		}
		if decodeN(w, r, 2<<10, &b) {
			err := s.Studios.Review(r.Context(), r.PathValue("slug"), b.Approve, b.Note)
			reply(w, map[string]bool{"ok": err == nil}, err)
		}
	}))
}
