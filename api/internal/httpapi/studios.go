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
	withSteps := func(w http.ResponseWriter, a accounts.Account, st studios.Studio, err error) {
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"studio": st, "steps": st.Steps(), "identityOk": a.IDVerified && a.FaceVerified})
	}

	// Published studio premieres, for the web app's catalog. Public facts only.
	mux.HandleFunc("GET /v1/studio-films", func(w http.ResponseWriter, r *http.Request) {
		list, err := s.Studios.LiveFilms(r.Context())
		reply(w, map[string]any{"films": list}, err)
	})
	mux.HandleFunc("GET /v1/studio-films/{upload}/poster", func(w http.ResponseWriter, r *http.Request) {
		key, err := s.Studios.LivePosterKey(r.Context(), r.PathValue("upload"))
		reply(w, map[string]string{"key": key}, err)
	})

	mux.HandleFunc("GET /v1/me/studio", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		st, err := s.Studios.Mine(r.Context(), a.ID, a.Email)
		if err == studios.ErrNotFound {
			writeJSON(w, http.StatusOK, map[string]any{"studio": nil, "identityOk": a.IDVerified && a.FaceVerified})
			return
		}
		withSteps(w, a, st, err)
	}))
	mux.HandleFunc("PUT /v1/me/studio", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var d studios.Draft
		if decodeN(w, r, 4<<10, &d) {
			st, err := s.Studios.Save(r.Context(), a.ID, a.Email, d)
			withSteps(w, a, st, err)
		}
	}))
	mux.HandleFunc("PUT /v1/me/studio/docs", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b struct {
			Key string
			OK  bool
		}
		if decodeN(w, r, 2<<10, &b) {
			st, err := s.Studios.SetDocs(r.Context(), a.ID, a.Email, b.Key, b.OK)
			withSteps(w, a, st, err)
		}
	}))
	mux.HandleFunc("PUT /v1/me/studio/payout", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var p studios.Payout
		if decodeN(w, r, 2<<10, &p) {
			st, err := s.Studios.SetPayout(r.Context(), a.ID, a.Email, p)
			withSteps(w, a, st, err)
		}
	}))
	mux.HandleFunc("PUT /v1/me/studio/rights", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b struct{ Note string }
		if decodeN(w, r, 8<<10, &b) {
			st, err := s.Studios.DeclareRights(r.Context(), a.ID, a.Email, b.Note)
			withSteps(w, a, st, err)
		}
	}))
	mux.HandleFunc("POST /v1/me/studio/terms", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		st, err := s.Studios.AcceptTerms(r.Context(), a.ID, a.Email)
		withSteps(w, a, st, err)
	}))
	mux.HandleFunc("POST /v1/me/studio/submit", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		if !a.IDVerified || !a.FaceVerified {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "Verify your face and ID first, so we know who runs this studio"})
			return
		}
		st, err := s.Studios.Submit(r.Context(), a.ID, a.Email)
		withSteps(w, a, st, err)
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

	// Film uploads (Figma 35:290). The web app moves the bytes; these routes keep the record.
	mux.HandleFunc("GET /v1/me/studio/uploads", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		u, err := s.Studios.Uploads(r.Context(), a.ID, a.Email)
		reply(w, map[string]any{"uploads": u}, err)
	}))
	mux.HandleFunc("POST /v1/me/studio/uploads", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b struct{ Title string }
		if decodeN(w, r, 1<<10, &b) {
			u, err := s.Studios.CreateUpload(r.Context(), a.ID, a.Email, b.Title)
			reply(w, map[string]any{"upload": u}, err)
		}
	}))
	mux.HandleFunc("GET /v1/me/studio/uploads/{id}", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		u, err := s.Studios.Upload(r.Context(), a.ID, a.Email, r.PathValue("id"))
		reply(w, map[string]any{"upload": u}, err)
	}))
	mux.HandleFunc("PUT /v1/me/studio/uploads/{id}", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b struct{ Title string }
		if decodeN(w, r, 1<<10, &b) {
			u, err := s.Studios.RenameUpload(r.Context(), a.ID, a.Email, r.PathValue("id"), b.Title)
			reply(w, map[string]any{"upload": u}, err)
		}
	}))
	mux.HandleFunc("PUT /v1/me/studio/uploads/{id}/details", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var d studios.Details
		if decodeN(w, r, 4<<10, &d) {
			u, err := s.Studios.SaveDetails(r.Context(), a.ID, a.Email, r.PathValue("id"), d)
			reply(w, map[string]any{"upload": u}, err)
		}
	}))
	mux.HandleFunc("PUT /v1/me/studio/uploads/{id}/poster", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b struct{ Key string }
		if decodeN(w, r, 1<<10, &b) {
			u, err := s.Studios.SetPoster(r.Context(), a.ID, a.Email, r.PathValue("id"), b.Key)
			reply(w, map[string]any{"upload": u}, err)
		}
	}))
	mux.HandleFunc("GET /v1/me/studio/uploads/{id}/premiere", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		p, err := s.Studios.Premiere(r.Context(), a.ID, a.Email, r.PathValue("id"))
		reply(w, map[string]any{"premiere": p}, err)
	}))
	mux.HandleFunc("PUT /v1/me/studio/uploads/{id}/premiere", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var in studios.PremiereInput
		if decodeN(w, r, 64<<10, &in) {
			p, err := s.Studios.SavePremiere(r.Context(), a.ID, a.Email, r.PathValue("id"), in, time.Now())
			reply(w, map[string]any{"premiere": p}, err)
		}
	}))
	mux.HandleFunc("DELETE /v1/me/studio/uploads/{id}", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		err := s.Studios.DeleteUpload(r.Context(), a.ID, a.Email, r.PathValue("id"))
		reply(w, map[string]bool{"ok": err == nil}, err)
	}))
	mux.HandleFunc("POST /v1/me/studio/uploads/{id}/files", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b struct {
			Name string
			Size int64
		}
		if decodeN(w, r, 1<<10, &b) {
			f, err := s.Studios.AddFile(r.Context(), a.ID, a.Email, r.PathValue("id"), b.Name, b.Size)
			reply(w, map[string]any{"file": f}, err)
		}
	}))
	mux.HandleFunc("GET /v1/me/studio/uploads/{id}/files/{file}", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		f, err := s.Studios.File(r.Context(), a.ID, a.Email, r.PathValue("id"), r.PathValue("file"), r.URL.Query().Get("write") == "1")
		reply(w, map[string]any{"file": f}, err)
	}))
	mux.HandleFunc("PUT /v1/me/studio/uploads/{id}/files/{file}", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b studios.FileUpdate
		if decodeN(w, r, 8<<10, &b) {
			f, err := s.Studios.UpdateFile(r.Context(), a.ID, a.Email, r.PathValue("id"), r.PathValue("file"), b)
			reply(w, map[string]any{"file": f}, err)
		}
	}))
	mux.HandleFunc("DELETE /v1/me/studio/uploads/{id}/files/{file}", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		err := s.Studios.RemoveFile(r.Context(), a.ID, a.Email, r.PathValue("id"), r.PathValue("file"))
		reply(w, map[string]bool{"ok": err == nil}, err)
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
