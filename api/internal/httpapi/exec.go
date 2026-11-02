package httpapi

import (
	"errors"
	"github.com/Bolajiomo99/E-Cinema/api/internal/careers"
	"github.com/Bolajiomo99/E-Cinema/api/internal/rooms"
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
	// Content and studios (Figma 82:633), and approving a ready studio from it.
	mux.HandleFunc("GET /v1/me/exec/content", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		c, err := s.Exec.Content(r.Context(), a.Email, time.Now())
		reply(w, c, err)
	}))
	mux.HandleFunc("POST /v1/me/exec/studios/{slug}/approve", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		if err := s.Exec.CanDecideStudios(r.Context(), a.Email); err != nil {
			fail(w, err)
			return
		}
		ready, err := s.Exec.StudioReady(r.Context(), r.PathValue("slug"))
		if err != nil {
			fail(w, err)
			return
		}
		if !ready {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "Check this studio's documents on the studio desk first"})
			return
		}
		if err := s.Studios.Review(r.Context(), r.PathValue("slug"), true, "Approved by "+a.Email); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	// Live operations (Figma 82:852): what plays right now, from the watch-room hub.
	mux.HandleFunc("GET /v1/me/exec/live", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		if err := s.Exec.Allow(r.Context(), a.Email, "coo", "cto"); err != nil {
			fail(w, err)
			return
		}
		now := time.Now()
		rows, err := s.Exec.DB.Query(r.Context(), `SELECT id, film, studio, starts_at, duration_min FROM showtimes
		  WHERE starts_at <= $1 AND starts_at + make_interval(mins => duration_min) > $1 ORDER BY starts_at`, now)
		if err != nil {
			fail(w, err)
			return
		}
		type playing struct {
			ID        string         `json:"id"`
			Film      string         `json:"film"`
			Studio    string         `json:"studio"`
			Starts    time.Time      `json:"starts"`
			Ends      time.Time      `json:"ends"`
			Watching  int            `json:"watching"`
			Peak      int            `json:"peak"`
			ByCountry map[string]int `json:"byCountry"`
		}
		list := []playing{}
		for rows.Next() {
			var p playing
			var mins int
			if err := rows.Scan(&p.ID, &p.Film, &p.Studio, &p.Starts, &mins); err != nil {
				rows.Close()
				fail(w, err)
				return
			}
			p.Ends = p.Starts.Add(time.Duration(mins) * time.Minute)
			st := s.Hub.StatOf(p.ID)
			p.Watching, p.ByCountry, p.Peak = st.Watching, st.ByCountry, s.Hub.PeakOf(p.ID).Watching
			list = append(list, p)
		}
		rows.Close()
		sort.SliceStable(list, func(i, j int) bool { return list[i].Watching > list[j].Watching })
		writeJSON(w, http.StatusOK, map[string]any{"playing": list})
	}))
	// Safety and trust (Figma 82:1075). Keep or remove a reported world-chat message.
	mux.HandleFunc("GET /v1/me/exec/safety", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		sf, err := s.Exec.Safety(r.Context(), a.Email, time.Now())
		reply(w, sf, err)
	}))
	mux.HandleFunc("POST /v1/me/exec/safety/{showtime}/{message}", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		if err := s.Exec.CanModerate(r.Context(), a.Email); err != nil {
			fail(w, err)
			return
		}
		var b struct {
			Remove bool `json:"remove"`
		}
		if !decode(w, r, &b) {
			return
		}
		id, err := strconv.ParseInt(r.PathValue("message"), 10, 64)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad message"})
			return
		}
		hidden, err := s.Rooms.Moderate(r.Context(), r.PathValue("showtime"), id, b.Remove)
		if errors.Is(err, rooms.ErrNoMessage) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "That report was already settled"})
			return
		}
		reply(w, map[string]bool{"hidden": hidden}, err)
	}))
	// Hiring and jobs (Figma 117:948). The CEO and COO post roles; only the CEO changes the Nigeria quota.
	mux.HandleFunc("GET /v1/me/exec/hiring", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		h, err := s.Exec.Hiring(r.Context(), a.Email, time.Now())
		reply(w, h, err)
	}))
	mux.HandleFunc("PUT /v1/me/exec/jobs/{slug}", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		if err := s.Exec.CanHire(r.Context(), a.Email); err != nil {
			fail(w, err)
			return
		}
		var j careers.Job
		if !decode(w, r, &j) {
			return
		}
		j.Slug = r.PathValue("slug")
		saved, err := s.Careers.SaveJob(r.Context(), j)
		reply(w, saved, err)
	}))
	mux.HandleFunc("PUT /v1/me/exec/hiring/share", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		if err := s.Exec.CanSetQuota(a.Email); err != nil {
			fail(w, err)
			return
		}
		var b struct {
			NGShare int `json:"ngShare"`
		}
		if !decode(w, r, &b) {
			return
		}
		reply(w, map[string]int{"ngShare": b.NGShare}, s.Careers.SetShare(r.Context(), b.NGShare))
	}))
	// Rooms and VR halls (Figma 83:831).
	mux.HandleFunc("GET /v1/me/exec/rooms", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		rm, err := s.Exec.Rooms(r.Context(), a.Email, time.Now())
		reply(w, rm, err)
	}))
	mux.HandleFunc("PUT /v1/me/exec/rooms", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var in exec.RoomType
		if !decode(w, r, &in) {
			return
		}
		id, err := s.Exec.SaveRoom(r.Context(), a.Email, in)
		reply(w, map[string]string{"id": id}, err)
	}))
	// Shop and merch (Figma 51:657) and Add a product (83:631).
	mux.HandleFunc("GET /v1/me/exec/shop", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		sh, err := s.Exec.Shop(r.Context(), a.Email, time.Now())
		reply(w, sh, err)
	}))
	mux.HandleFunc("GET /v1/me/exec/can-add", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		ok, err := s.Exec.CanAddProducts(r.Context(), a.Email)
		reply(w, map[string]bool{"canAdd": ok}, err)
	}))
	mux.HandleFunc("PUT /v1/me/exec/products", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var in exec.ProductInput
		if !decode(w, r, &in) {
			return
		}
		id, err := s.Exec.SaveProduct(r.Context(), a.Email, in)
		reply(w, map[string]string{"id": id}, err)
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
