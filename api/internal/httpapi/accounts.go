package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"time"

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
		if errors.Is(err, accounts.ErrSecondStep) {
			// Two-step verification: the password was right; a code finishes the sign-in.
			out, cerr := s.Accounts.IssueCode(r.Context(), acct.Email, "login")
			if cerr != nil && !errors.Is(cerr, accounts.ErrTooSoon) {
				fail(w, cerr)
				return
			}
			if out.MaskedTo == "" {
				out.MaskedTo = accounts.MaskEmail(acct.Email)
			}
			writeJSON(w, http.StatusAccepted, map[string]any{"secondStep": true, "code": out, "identifier": acct.Email})
			return
		}
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"account": acct, "session": sess})
	}))
	// One-time codes: sign in without a password, or reset it (Figma 16:296, 105:1186-105:1447).
	// The web app emails the code when the reply carries one; texts go out from here.
	mux.HandleFunc("POST /v1/codes", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Identifier, Purpose string }
		if !decode(w, r, &b) {
			return
		}
		out, err := s.Accounts.IssueCode(r.Context(), b.Identifier, b.Purpose)
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
	mux.HandleFunc("POST /v1/codes/login", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Identifier, Code, Device string }
		if !decode(w, r, &b) {
			return
		}
		acct, sess, err := s.Accounts.SignInWithCode(r.Context(), b.Identifier, b.Code, b.Device)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"account": acct, "session": sess})
	}))
	mux.HandleFunc("POST /v1/codes/reset", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Identifier, Code string }
		if !decode(w, r, &b) {
			return
		}
		token, err := s.Accounts.VerifyResetCode(r.Context(), b.Identifier, b.Code)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"resetToken": token})
	}))
	mux.HandleFunc("POST /v1/password/reset", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Token, Password, Device string
			SignOutOthers           bool
		}
		if !decode(w, r, &b) {
			return
		}
		res, err := s.Accounts.ResetPassword(r.Context(), b.Token, b.Password, b.Device, b.SignOutOthers)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, res)
	}))
	mux.HandleFunc("POST /v1/password/lock", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Token string }
		if !decode(w, r, &b) {
			return
		}
		email, err := s.Accounts.LockAccount(r.Context(), b.Token)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"email": email})
	}))
	mux.HandleFunc("POST /v1/sessions/external", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Provider, Subject, Email, Name, Device string
			EmailVerified                          bool
		}
		if !decode(w, r, &b) {
			return
		}
		acct, sess, created, err := s.Accounts.SignInExternal(r.Context(), b.Provider, b.Subject, b.Email, b.EmailVerified, b.Name, b.Device)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"account": acct, "session": sess, "created": created})
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
	mux.HandleFunc("GET /v1/me/settings", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		out, err := s.Accounts.GetSettings(r.Context(), a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, out)
	}))
	mux.HandleFunc("PATCH /v1/me/settings", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b accounts.SettingsChange
		if !decode(w, r, &b) {
			return
		}
		out, err := s.Accounts.UpdateSettings(r.Context(), a.ID, b)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, out)
	}))
	mux.HandleFunc("POST /v1/me/password", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct{ Current, Password string }
		if !decode(w, r, &b) {
			return
		}
		if err := s.Accounts.ChangePassword(r.Context(), a.ID, b.Current, b.Password); err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}))
	mux.HandleFunc("POST /v1/me/signout-all", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		n, err := s.Accounts.SignOutEverywhere(r.Context(), a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]int{"signedOut": n})
	}))
	mux.HandleFunc("DELETE /v1/me/identities/{provider}", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		if err := s.Accounts.RemoveIdentity(r.Context(), a.ID, r.PathValue("provider")); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("POST /v1/me/delete", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct{ Confirm string }
		if !decode(w, r, &b) {
			return
		}
		if b.Confirm != "DELETE" {
			fail(w, fmt.Errorf("%w: type DELETE to confirm", accounts.ErrBadInput))
			return
		}
		at, err := s.Accounts.ScheduleDelete(r.Context(), a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"deleteAfter": at, "email": a.Email})
	}))
	mux.HandleFunc("GET /v1/me/export", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		out, err := s.Accounts.Export(r.Context(), a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, out)
	}))
	mux.HandleFunc("GET /v1/me/profile", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		p, err := s.Accounts.GetProfile(r.Context(), a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, p)
	}))
	mux.HandleFunc("PUT /v1/me/profile", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b accounts.Profile
		if !decode(w, r, &b) {
			return
		}
		p, err := s.Accounts.SaveProfile(r.Context(), a.ID, b, time.Now())
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, p)
	}))
	mux.HandleFunc("PUT /v1/me/plan", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct{ Plan string }
		if !decode(w, r, &b) {
			return
		}
		p, err := s.Accounts.ChoosePlan(r.Context(), a.ID, b.Plan)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, p)
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
	mux.HandleFunc("POST /v1/passkeys/register/begin", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		id, opts, err := s.Accounts.BeginPasskeyRegistration(r.Context(), a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"challengeId": id, "options": opts})
	}))
	mux.HandleFunc("POST /v1/passkeys/register/finish", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct {
			ChallengeID string          `json:"challengeId"`
			Name        string          `json:"name"`
			Credential  json.RawMessage `json:"credential"`
		}
		if !decodeLarge(w, r, &b) {
			return
		}
		p, err := s.Accounts.FinishPasskeyRegistration(r.Context(), a.ID, b.ChallengeID, b.Name, b.Credential)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, p)
	}))
	mux.HandleFunc("POST /v1/passkeys/login/begin", s.internal(func(w http.ResponseWriter, r *http.Request) {
		id, opts, err := s.Accounts.BeginPasskeyLogin(r.Context())
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"challengeId": id, "options": opts})
	}))
	mux.HandleFunc("POST /v1/passkeys/login/finish", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			ChallengeID string          `json:"challengeId"`
			Device      string          `json:"device"`
			Credential  json.RawMessage `json:"credential"`
		}
		if !decodeLarge(w, r, &b) {
			return
		}
		acct, sess, err := s.Accounts.FinishPasskeyLogin(r.Context(), b.ChallengeID, b.Credential, b.Device)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"account": acct, "session": sess})
	}))
	mux.HandleFunc("GET /v1/passkeys", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		list, err := s.Accounts.Passkeys(r.Context(), a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"passkeys": list})
	}))
	mux.HandleFunc("DELETE /v1/passkeys/{id}", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		if !hexID.MatchString(r.PathValue("id")) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		if err := s.Accounts.DeletePasskey(r.Context(), a.ID, r.PathValue("id")); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
}

var hexID = regexp.MustCompile(`^[0-9a-f]{2,1000}$`)

// decodeLarge allows the bigger bodies WebAuthn responses need (attestation objects).
func decodeLarge(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(v); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return false
	}
	return true
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
