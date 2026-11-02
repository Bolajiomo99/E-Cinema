package httpapi

import (
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
	"github.com/Bolajiomo99/E-Cinema/api/internal/exec"
)

// Executive dashboards (Figma page "07 Executive").
func (s *Server) execRoutes(mux *http.ServeMux) {
	on := func(fn func(w http.ResponseWriter, r *http.Request, a accounts.Account)) http.HandlerFunc {
		return s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) { fn(w, r, a) })
	}
	mux.HandleFunc("GET /v1/me/exec", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		role, err := s.Exec.Role(r.Context(), a.Email)
		if err != nil || role == "" {
			reply(w, map[string]any{"role": role, "money": false}, err)
			return
		}
		money, err := s.Exec.CanSeeMoney(r.Context(), a.Email)
		reply(w, map[string]any{"role": role, "money": money}, err)
	}))
	// Access and roles (Figma 49:1307): the CEO's list of people, grant or change, and remove.
	mux.HandleFunc("GET /v1/me/exec/people", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		p, err := s.Exec.People(r.Context(), a.Email)
		reply(w, map[string]any{"people": p, "scopes": exec.Scopes}, err)
	}))
	mux.HandleFunc("PUT /v1/me/exec/people", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var g exec.Grant
		if !decode(w, r, &g) {
			return
		}
		added, err := s.Exec.Grant(r.Context(), a.Email, a.ID, g, time.Now())
		reply(w, map[string]bool{"added": added}, err)
	}))
	mux.HandleFunc("DELETE /v1/me/exec/people/{email}", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		if err := s.Exec.Revoke(r.Context(), a.Email, r.PathValue("email")); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	// Money (Figma 50:253): the CEO, the CFO and anyone allowed to see money.
	mux.HandleFunc("GET /v1/me/exec/money", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		days, _ := strconv.Atoi(r.URL.Query().Get("days"))
		m, err := s.Exec.Money(r.Context(), a.Email, days, time.Now())
		reply(w, m, err)
	}))
	// Growth and users (Figma 82:409).
	mux.HandleFunc("GET /v1/me/exec/growth", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		days, _ := strconv.Atoi(r.URL.Query().Get("days"))
		g, err := s.Exec.Growth(r.Context(), a.Email, days, r.URL.Query().Get("country"), time.Now())
		reply(w, g, err)
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
