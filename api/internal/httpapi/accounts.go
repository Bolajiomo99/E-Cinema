package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
)

// Account routes are internal: only the web app calls them, passing the viewer's
// session token (kept in an httpOnly cookie on the web side) in X-Session-Token.
func (s *Server) accountRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/accounts", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Email, Name, Password, Device string }
		if !decode(w, r, &b) {
			return
		}
		acct, sess, err := s.Accounts.SignUp(r.Context(), b.Email, b.Name, b.Password, b.Device)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"account": acct, "session": sess})
	}))
	mux.HandleFunc("POST /v1/sessions", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Email, Password, Device string }
		if !decode(w, r, &b) {
			return
		}
		acct, sess, err := s.Accounts.SignIn(r.Context(), b.Email, b.Password, b.Device)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"account": acct, "session": sess})
	}))
	mux.HandleFunc("GET /v1/sessions/current", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		writeJSON(w, http.StatusOK, map[string]any{"account": a})
	}))
	mux.HandleFunc("DELETE /v1/sessions/current", s.internal(func(w http.ResponseWriter, r *http.Request) {
		if err := s.Accounts.SignOut(r.Context(), r.Header.Get("X-Session-Token")); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("GET /v1/devices", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, sid string) {
		list, err := s.Accounts.Devices(r.Context(), a.ID, sid)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"devices": list, "max": accounts.MaxDevices})
	}))
	mux.HandleFunc("DELETE /v1/devices/{id}", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		if err := s.Accounts.SignOutDevice(r.Context(), a.ID, r.PathValue("id")); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("POST /v1/phone", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct{ Phone string }
		if !decode(w, r, &b) {
			return
		}
		phone, err := s.Accounts.StartPhoneCheck(r.Context(), a.ID, b.Phone)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"sentTo": phone})
	}))
	mux.HandleFunc("POST /v1/phone/confirm", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct{ Code string }
		if !decode(w, r, &b) {
			return
		}
		acct, err := s.Accounts.ConfirmPhone(r.Context(), a.ID, b.Code)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"account": acct})
	}))
	mux.HandleFunc("POST /v1/identity/token", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		if s.Identity == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "face checks are not switched on yet"})
			return
		}
		tok, err := s.Identity.SDKToken(r.Context(), a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"token": tok})
	}))
	mux.HandleFunc("POST /v1/identity/refresh", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		if s.Identity == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "face checks are not switched on yet"})
			return
		}
		res, err := s.Identity.Check(r.Context(), a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		acct, err := s.Accounts.RecordIdentity(r.Context(), a.ID, res.Status)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"account": acct, "check": res})
	}))
}

func (s *Server) signedIn(next func(http.ResponseWriter, *http.Request, accounts.Account, string)) http.HandlerFunc {
	return s.internal(func(w http.ResponseWriter, r *http.Request) {
		acct, sid, err := s.Accounts.Authenticate(r.Context(), r.Header.Get("X-Session-Token"))
		if err != nil {
			fail(w, err)
			return
		}
		next(w, r, acct, sid)
	})
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(v); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return false
	}
	return true
}
