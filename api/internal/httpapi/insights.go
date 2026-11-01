package httpapi

import (
	"net/http"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
)

// Insights routes (Figma 19:462): player heartbeats in, the viewer's own report out.
func (s *Server) insightRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/me/watch-beats", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct {
			ShowtimeID string `json:"showtimeId"`
			Mode       string `json:"mode"`
			Audio      string `json:"audio"`
			Subs       string `json:"subs"`
			Seconds    int    `json:"seconds"`
		}
		if !decode(w, r, &b) {
			return
		}
		ok, err := s.Insights.Record(r.Context(), a.ID, b.ShowtimeID, b.Mode, b.Audio, b.Subs, b.Seconds, time.Now())
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"counted": ok})
	}))
	mux.HandleFunc("GET /v1/me/insights", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		now := time.Now().UTC()
		month := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
		from, to := month, month.AddDate(0, 1, 0)
		switch r.URL.Query().Get("range") {
		case "6m":
			from = month.AddDate(0, -5, 0)
		case "all":
			from = a.CreatedAt.UTC()
		}
		rep, err := s.Insights.Report(r.Context(), a.ID, from, to, now)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, rep)
	}))
}
