package httpapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
	"github.com/Bolajiomo99/E-Cinema/api/internal/playback"
)

// Insights routes (Figma 19:462): player heartbeats in, the viewer's own report out.
func (s *Server) insightRoutes(mux *http.ServeMux) {
	// Film page visits and trailer clip plays for the studio ticket funnel. The web server sends
	// a salted visitor hash, never an account id or address.
	mux.HandleFunc("POST /v1/views", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			ShowtimeID string `json:"showtimeId"`
			Kind       string `json:"kind"`
			Visitor    string `json:"visitor"`
			Country    string `json:"country"`
		}
		if !decode(w, r, &b) {
			return
		}
		ok, err := s.Playback.View(r.Context(), b.ShowtimeID, b.Kind, b.Visitor, b.Country, time.Now())
		if errors.Is(err, playback.ErrBadInput) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "showtimeId, kind (page or clip) and visitor are required"})
			return
		}
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"counted": ok})
	}))
	mux.HandleFunc("POST /v1/me/watch-beats", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct {
			ShowtimeID string `json:"showtimeId"`
			Mode       string `json:"mode"`
			Audio      string `json:"audio"`
			Subs       string `json:"subs"`
			Seconds    int    `json:"seconds"`
			playback.Report
		}
		if !decode(w, r, &b) {
			return
		}
		now := time.Now()
		ok, err := s.Insights.Record(r.Context(), a.ID, b.ShowtimeID, b.Mode, b.Audio, b.Subs, b.Seconds, now)
		if err != nil {
			fail(w, err)
			return
		}
		// Player reports ride on the same beat, so a beat sent too soon is not counted twice.
		if ok {
			if err := s.Playback.Record(r.Context(), a.ID, b.ShowtimeID, b.Mode, b.Report, now); err != nil && !errors.Is(err, playback.ErrBadInput) {
				fail(w, err)
				return
			}
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
