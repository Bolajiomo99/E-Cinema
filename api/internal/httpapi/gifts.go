package httpapi

import (
	"net/http"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
	"github.com/Bolajiomo99/E-Cinema/api/internal/gifts"
)

// Gift a seat (Figma 94:1398) and the credit it can turn into.
func (s *Server) giftRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/gifts", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b gifts.New
		if !decode(w, r, &b) {
			return
		}
		g, err := s.Gifts.Create(r.Context(), a.ID, b)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, g)
	}))
	mux.HandleFunc("GET /v1/me/gifts", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		list, err := s.Gifts.Sent(r.Context(), a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, list)
	}))
	mux.HandleFunc("GET /v1/gifts/{code}", s.internal(func(w http.ResponseWriter, r *http.Request) {
		g, err := s.Gifts.ByCode(r.Context(), r.PathValue("code"))
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, g)
	}))
	mux.HandleFunc("POST /v1/gifts/{code}/redeem", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		out, err := s.Gifts.Redeem(r.Context(), r.PathValue("code"), a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, out)
	}))
	// Gifts whose delivery time has come, each handed out once; the web app emails them.
	mux.HandleFunc("POST /v1/gifts/due", s.internal(func(w http.ResponseWriter, r *http.Request) {
		list, err := s.Gifts.Due(r.Context())
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, list)
	}))
	mux.HandleFunc("GET /v1/me/credit", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		c, err := s.Gifts.Balance(r.Context(), a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"cents": c, "currency": "USD"})
	}))
	mux.HandleFunc("POST /v1/me/holds/{id}/credit", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct {
			Cents    int `json:"cents"`
			NetCents int `json:"netCents"`
		}
		if !decode(w, r, &b) {
			return
		}
		if err := s.Gifts.PayWithCredit(r.Context(), a.ID, r.PathValue("id"), b.Cents, b.NetCents); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	// Cancelling a seat paid with credit puts the credit back instead of refunding on PayPal.
	mux.HandleFunc("POST /v1/me/holds/{id}/credit/refund", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		c, err := s.Tickets.CanCancel(r.Context(), a.ID, r.PathValue("id"))
		if err != nil {
			fail(w, err)
			return
		}
		if c.CaptureID != "CREDIT-"+c.HoldID {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "this seat was not paid with credit"})
			return
		}
		cents, err := s.Gifts.RefundCredit(r.Context(), a.ID, c.HoldID)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"cents": cents})
	}))
	// Pre-show quiz: the web server checks the answers and the ticket, then records the one try here.
	mux.HandleFunc("POST /v1/internal/quiz", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			AccountID, ShowtimeID string
			Score, PrizeCents     int
		}
		if !decode(w, r, &b) {
			return
		}
		out, err := s.Gifts.QuizTry(r.Context(), b.AccountID, b.ShowtimeID, b.Score, b.PrizeCents)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, out)
	}))
	mux.HandleFunc("GET /v1/me/quiz/{showtime}", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		out, err := s.Gifts.QuizDone(r.Context(), a.ID, r.PathValue("showtime"))
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"done": out})
	}))
}
