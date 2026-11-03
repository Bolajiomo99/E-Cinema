package httpapi

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
	"github.com/Bolajiomo99/E-Cinema/api/internal/tickets"
)

// The 18+ unlock (Figma 28:839): adult status, PIN, a code per stage, and the stage ledger.
func (s *Server) adultRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/me/adult/{showtime}", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		st, err := s.Accounts.Adult(r.Context(), a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		stages, err := s.Tickets.Stages(r.Context(), a.ID, r.PathValue("showtime"))
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"status": st, "stages": stages})
	}))
	mux.HandleFunc("PUT /v1/me/adult/pin", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct{ PIN string }
		if !decode(w, r, &b) {
			return
		}
		if err := s.Accounts.SetAdultPIN(r.Context(), a.ID, b.PIN); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	// The web app emails the code when the reply carries one; texts go out from here.
	mux.HandleFunc("POST /v1/me/adult/code", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		out, err := s.Accounts.IssueAdultCode(r.Context(), a.ID)
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
	mux.HandleFunc("POST /v1/me/adult/grant", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct{ PIN, Code string }
		if !decode(w, r, &b) {
			return
		}
		g, err := s.Accounts.AdultGrant(r.Context(), a.ID, b.PIN, b.Code)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"grant": g})
	}))
	// The recipients a viewer can pick for a fund stage (1 to 3): names and places only.
	mux.HandleFunc("GET /v1/adult/recipients/{stage}", func(w http.ResponseWriter, r *http.Request) {
		stage, _ := strconv.Atoi(r.PathValue("stage"))
		list, err := s.Tickets.Recipients(r.Context(), stage)
		if list == nil {
			list = []tickets.Recipient{}
		}
		reply(w, list, err)
	})
	// Records the PayPal order for a fund stage. The grant proves the PIN and code were checked.
	mux.HandleFunc("POST /v1/me/adult/{showtime}/stages", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct {
			Stage       int    `json:"stage"`
			OrderID     string `json:"orderId"`
			AmountCents int    `json:"amountCents"`
			Currency    string `json:"currency"`
			Grant       string `json:"grant"`
			Recipient   string `json:"recipient,omitempty"`
		}
		if !decode(w, r, &b) {
			return
		}
		if err := s.Accounts.UseAdultGrant(r.Context(), a.ID, b.Grant); err != nil {
			fail(w, err)
			return
		}
		if err := s.Tickets.AttachStage(r.Context(), a.ID, r.PathValue("showtime"), b.Stage, b.OrderID, b.AmountCents, b.Currency, b.Recipient); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	// Spends a grant without a stage row: the seat (stage 4) is a normal hold.
	mux.HandleFunc("POST /v1/me/adult/grant/use", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct{ Grant string }
		if !decode(w, r, &b) {
			return
		}
		if err := s.Accounts.UseAdultGrant(r.Context(), a.ID, b.Grant); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
}
