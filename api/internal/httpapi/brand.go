package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
	"github.com/Bolajiomo99/E-Cinema/api/internal/brand"
	"github.com/Bolajiomo99/E-Cinema/api/internal/notify"
)

// Brand protection (Figma 114:1670, 114:1733, 114:1751, 114:1818).
func (s *Server) brandRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/brand/verify", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Code, City, Country string }
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&b); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad request"})
			return
		}
		c, err := s.Brand.Verify(r.Context(), b.Code, brand.Place{City: b.City, Country: b.Country}, "")
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, c)
	}))
	mux.HandleFunc("GET /v1/brand/licensees", s.internal(func(w http.ResponseWriter, r *http.Request) {
		list, err := s.Brand.Licensees(r.Context())
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"licensees": list})
	}))
	mux.HandleFunc("GET /v1/me/rewards", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		sum, err := s.Brand.Rewards(r.Context(), a.ID, r.URL.Query().Get("country"))
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, sum)
	}))
	mux.HandleFunc("POST /v1/me/brand-reports", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var n brand.New
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&n); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad request"})
			return
		}
		rep, err := s.Brand.Send(r.Context(), a.ID, n)
		if err != nil {
			fail(w, err)
			return
		}
		s.reportMail(rep, "report_received")
		writeJSON(w, http.StatusCreated, rep)
	}))
	mux.HandleFunc("GET /v1/brand/reports/open", s.internal(func(w http.ResponseWriter, r *http.Request) {
		list, err := s.Brand.Open(r.Context())
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"reports": list})
	}))
	mux.HandleFunc("GET /v1/brand/reports/{id}", s.internal(func(w http.ResponseWriter, r *http.Request) {
		rep, err := s.Brand.Get(r.Context(), r.PathValue("id"))
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, rep)
	}))
	mux.HandleFunc("POST /v1/brand/reports/{id}/decide", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var d brand.Decision
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&d); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad request"})
			return
		}
		rep, err := s.Brand.Decide(r.Context(), r.PathValue("id"), d)
		if err != nil {
			fail(w, err)
			return
		}
		s.reportDecided(rep)
		writeJSON(w, http.StatusOK, rep)
	}))
}

// What the reporter reads when an investigator moves their report on.
func (s *Server) reportDecided(r brand.Report) {
	var title, body string
	kind := "social"
	switch r.Status {
	case "checking":
		title, body = "An investigator is checking your report", "We will tell you as soon as it is confirmed."
	case "confirmed":
		kind = "payment"
		title = fmt.Sprintf("Report confirmed: ₦%s reward", thousands(r.RewardNGN))
		body = fmt.Sprintf("The seller was %s. Your reward is in your wallet, plus %d points.", r.Outcome, r.Points)
	case "rejected":
		title, body = "We could not confirm your report", "There was not enough proof this time. Thank you for looking out for E-Cinema."
	case "false":
		title, body = "Your report was found to be untrue", fmt.Sprintf("False reports cost %d points.", -r.Points)
	default:
		return
	}
	go func() {
		_ = s.Notify.Add(context.Background(), r.Account, notify.New{Kind: kind, Title: title, Body: body, Link: "/rewards", Dedupe: "brand:" + r.ID + ":" + r.Status})
	}()
	switch r.Status {
	case "confirmed":
		s.reportMail(r, "report_paid")
	case "rejected":
		s.reportMail(r, "report_closed")
	}
}

// reportMail queues emails 35, 24 and 36 (Figma 127:259, 118:2917, 127:281) to the reporter.
func (s *Server) reportMail(r brand.Report, kind string) {
	if r.Account == "" {
		return
	}
	data := map[string]any{"place": r.Place, "selling": r.Selling, "outcome": r.Outcome, "rewardNgn": r.RewardNGN, "points": r.Points,
		"report": "RPT-" + strings.ToUpper(strings.ReplaceAll(r.ID, "-", "")[:6])}
	go func() {
		_ = s.Notify.QueueAccount(context.Background(), r.Account, notify.Mail{Kind: kind, Dedupe: "brandmail:" + r.ID + ":" + kind, Data: data})
	}()
}

func thousands(n int) string {
	s := fmt.Sprint(n)
	for i := len(s) - 3; i > 0; i -= 3 {
		s = s[:i] + "," + s[i:]
	}
	return s
}
