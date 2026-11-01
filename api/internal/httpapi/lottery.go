package httpapi

import (
	"net/http"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
	"github.com/Bolajiomo99/E-Cinema/api/internal/tickets"
)

// Sold out (Figma 31:1121): the free-seat lottery and the waitlist for returned paid seats.
func (s *Server) lotteryRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/lottery/{id}", s.internal(func(w http.ResponseWriter, r *http.Request) {
		accountID := ""
		if tok := r.Header.Get("X-Session-Token"); tok != "" {
			if acct, _, err := s.Accounts.Authenticate(r.Context(), tok); err == nil {
				accountID = acct.ID
			}
		}
		l, err := s.Tickets.LotteryState(r.Context(), r.PathValue("id"), accountID)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, l)
	}))
	// Runs the draw when it is due and picks waitlisted viewers for returned seats. Idempotent;
	// the web app calls it and emails whoever comes back.
	mux.HandleFunc("POST /v1/lottery/{id}/sweep", s.internal(func(w http.ResponseWriter, r *http.Request) {
		won, err := s.Tickets.Draw(r.Context(), r.PathValue("id"), time.Now())
		if err != nil {
			fail(w, err)
			return
		}
		back, err := s.Tickets.WaitlistDue(r.Context(), r.PathValue("id"))
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"winners": nonNil(won), "waitlist": nonNil(back)})
	}))
	mux.HandleFunc("POST /v1/lottery/{id}/enter", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		n, err := s.Tickets.EnterLottery(r.Context(), r.PathValue("id"), a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]int64{"entry": n})
	}))
	mux.HandleFunc("POST /v1/lottery/{id}/claim", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct{ HoldID string }
		if !decode(w, r, &b) {
			return
		}
		if err := s.Tickets.ClaimWin(r.Context(), a.ID, b.HoldID); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("PUT /v1/waitlist/{id}", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct{ On bool }
		if !decode(w, r, &b) {
			return
		}
		if err := s.Tickets.JoinWaitlist(r.Context(), r.PathValue("id"), a.ID, b.On); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
}

func nonNil(w []tickets.Winner) []tickets.Winner {
	if w == nil {
		return []tickets.Winner{}
	}
	return w
}
