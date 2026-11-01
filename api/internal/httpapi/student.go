package httpapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
)

// Student offer (Figma 94:1327): verify with a school email code, or a student ID the web server checked.
func (s *Server) studentRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/me/student", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		st, err := s.Accounts.Student(r.Context(), a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, st)
	}))
	// The reply carries the code and the school address; the web app emails it.
	mux.HandleFunc("POST /v1/me/student/code", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct{ School, Email string }
		if !decode(w, r, &b) {
			return
		}
		out, err := s.Accounts.StudentCode(r.Context(), a.ID, b.School, b.Email)
		if errors.Is(err, accounts.ErrPaused) {
			writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": err.Error(), "pausedFor": out.PausedFor})
			return
		}
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, out)
	}))
	mux.HandleFunc("POST /v1/me/student/verify", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct{ Code string }
		if !decode(w, r, &b) {
			return
		}
		st, err := s.Accounts.VerifyStudent(r.Context(), a.ID, b.Code)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, st)
	}))
	// Internal: the web server read the student ID photo and matched the name to the account.
	mux.HandleFunc("POST /v1/internal/student/id", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			AccountID, School string
			Expires           time.Time
		}
		if !decode(w, r, &b) {
			return
		}
		st, err := s.Accounts.StudentByID(r.Context(), b.AccountID, b.School, b.Expires)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, st)
	}))
}
