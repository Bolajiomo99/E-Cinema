package httpapi

import (
	"net/http"
	"sort"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
)

// Executive dashboards (Figma page "07 Executive").
func (s *Server) execRoutes(mux *http.ServeMux) {
	on := func(fn func(w http.ResponseWriter, r *http.Request, a accounts.Account)) http.HandlerFunc {
		return s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) { fn(w, r, a) })
	}
	mux.HandleFunc("GET /v1/me/exec", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		role, err := s.Exec.Role(r.Context(), a.Email)
		reply(w, map[string]string{"role": role}, err)
	}))
	// The command center (Figma 49:1055), with who is in a watch room right now from the hub.
	mux.HandleFunc("GET /v1/me/exec/command", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		c, err := s.Exec.Command(r.Context(), a.Email, time.Now())
		if err != nil {
			fail(w, err)
			return
		}
		stats := s.Hub.Stats()
		online, biggest := 0, 0
		countries := map[string]int{}
		for _, st := range stats {
			online += st.Watching
			if st.Watching > biggest {
				biggest = st.Watching
			}
			for k, v := range st.ByCountry {
				countries[k] += v
			}
		}
		type now struct {
			Country  string `json:"country"`
			Watching int    `json:"watching"`
		}
		live := []now{}
		for k, v := range countries {
			live = append(live, now{k, v})
		}
		sort.Slice(live, func(i, j int) bool { return live[i].Watching > live[j].Watching })
		writeJSON(w, http.StatusOK, map[string]any{"command": c, "online": online, "biggestRoom": biggest, "onlineByCountry": live})
	}))
}
