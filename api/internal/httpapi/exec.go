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
	"github.com/Bolajiomo99/E-Cinema/api/internal/notify"
	"github.com/Bolajiomo99/E-Cinema/api/internal/playback"
)

// execOnly guards every executive route: signed in, plus the "passkey and face for every
// executive" switch (Figma 83:386).
func (s *Server) execOnly(fn func(w http.ResponseWriter, r *http.Request, a accounts.Account)) http.HandlerFunc {
	return s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		ok, err := s.Exec.StrongOK(r.Context(), a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		if !ok {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "Add a passkey and finish the face check to open the executive area"})
			return
		}
		fn(w, r, a)
	})
}

// Executive dashboards (Figma page "07 Executive").
func (s *Server) execRoutes(mux *http.ServeMux) {
	// Every executive route checks the "passkey and face for every executive" switch (Figma 83:386).
	on := s.execOnly
	mux.HandleFunc("GET /v1/me/exec", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		role, err := s.Exec.Role(r.Context(), a.Email)
		if err != nil || role == "" {
			reply(w, map[string]any{"role": role, "money": false}, err)
			return
		}
		strong, err := s.Exec.StrongOK(r.Context(), a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		money, err := s.Exec.CanSeeMoney(r.Context(), a.Email)
		reply(w, map[string]any{"role": role, "money": money, "needsStrong": !strong}, err)
	}))
	// Settings (Figma 83:386): platform switches, public for the web to read, CEO to change.
	mux.HandleFunc("GET /v1/platform", func(w http.ResponseWriter, r *http.Request) {
		v, err := s.Exec.Platform(r.Context())
		reply(w, v, err)
	})
	mux.HandleFunc("GET /v1/me/exec/settings", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		p, err := s.Exec.Settings(r.Context(), a.Email, a.ID)
		reply(w, p, err)
	}))
	mux.HandleFunc("PUT /v1/me/exec/settings", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b struct {
			Key   string `json:"key"`
			Value any    `json:"value"`
		}
		if !decode(w, r, &b) {
			return
		}
		reply(w, map[string]any{"key": b.Key, "value": b.Value}, s.Exec.SetSetting(r.Context(), a.Email, a.ID, b.Key, b.Value))
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
		if err != nil {
			fail(w, err)
			return
		}
		// A new person, or "resend", gets a fresh one-time link while they have not joined yet.
		out := map[string]any{"added": added}
		if added || r.URL.Query().Get("invite") == "1" {
			tok, err := s.Exec.NewInvite(r.Context(), a.Email, g.Email, a.Name, time.Now())
			if err != nil {
				fail(w, err)
				return
			}
			out["invite"] = tok
			// Email 45 (Figma 127:479): a nudge 24 hours before the link runs out, dropped if
			// the invite is accepted or replaced first.
			_ = s.Notify.CancelKind(r.Context(), "exec_invite_expiring", g.Email)
			_ = s.Notify.Queue(r.Context(), notify.Mail{Kind: "exec_invite_expiring", To: g.Email, Name: g.Name, Dedupe: "execexp:" + tok[:12],
				SendAfter: time.Now().Add(exec.InviteFor - 24*time.Hour),
				Data:      map[string]any{"by": a.Name, "role": g.Role, "token": tok, "expiresAt": time.Now().Add(exec.InviteFor).Format(time.RFC3339)}})
		}
		reply(w, out, nil)
	}))
	// Executive invites (Figma 99:1696): the link page reads the invite before sign-in; the
	// invited person then confirms the inbox with a code and accepts once face and passkey are done.
	mux.HandleFunc("GET /v1/exec-invites/{token}", s.internal(func(w http.ResponseWriter, r *http.Request) {
		in, err := s.Exec.LookInvite(r.Context(), r.PathValue("token"), time.Now())
		reply(w, in, err)
	}))
	mux.HandleFunc("POST /v1/exec-invites/{token}/code", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		code, err := s.Exec.InviteCode(r.Context(), r.PathValue("token"), a.Email, time.Now())
		reply(w, map[string]string{"code": code, "email": a.Email}, err)
	}))
	mux.HandleFunc("POST /v1/exec-invites/{token}/confirm", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct{ Code string }
		if !decode(w, r, &b) {
			return
		}
		reply(w, map[string]bool{"ok": true}, s.Exec.ConfirmInviteCode(r.Context(), r.PathValue("token"), a.Email, b.Code, time.Now()))
	}))
	mux.HandleFunc("POST /v1/exec-invites/{token}/accept", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		err := s.Exec.AcceptInvite(r.Context(), r.PathValue("token"), a.Email, a.ID, time.Now())
		if err == nil {
			_ = s.Notify.CancelKind(r.Context(), "exec_invite_expiring", a.Email)
		}
		reply(w, map[string]bool{"ok": true}, err)
	}))
	mux.HandleFunc("DELETE /v1/me/exec/people/{email}", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		if err := s.Exec.Revoke(r.Context(), a.Email, r.PathValue("email")); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	// CEO global overview (Figma 117:684): revenue by stream, 12 weeks and this month.
	mux.HandleFunc("GET /v1/me/exec/overview", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		o, err := s.Exec.Overview(r.Context(), a.Email, time.Now())
		reply(w, o, err)
	}))
	// PayPal and AI agents (Figma 285:373): the CEO, the CFO and anyone allowed to see money.
	mux.HandleFunc("GET /v1/me/exec/paypal", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		days, _ := strconv.Atoi(r.URL.Query().Get("days"))
		pp, err := s.Exec.PayPal(r.Context(), a.Email, days, time.Now())
		reply(w, pp, err)
	}))
	// PayPal dispute events from the web's verified webhook.
	mux.HandleFunc("POST /v1/paypal-disputes", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			ID, CaptureID, Currency, Reason, Status, Outcome string
			Amount                                           int64
			Due                                              *time.Time
			Resolved                                         bool
		}
		if !decode(w, r, &b) {
			return
		}
		reply(w, map[string]bool{"ok": true}, s.Exec.SaveDispute(r.Context(), b.ID, b.CaptureID, b.Currency, b.Reason, b.Status, b.Outcome, b.Amount, b.Due, b.Resolved, time.Now()))
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
		s.studioApproved(r.PathValue("slug"))
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
			ID        string           `json:"id"`
			Film      string           `json:"film"`
			Studio    string           `json:"studio"`
			Starts    time.Time        `json:"starts"`
			Ends      time.Time        `json:"ends"`
			Watching  int              `json:"watching"`
			Peak      int              `json:"peak"`
			ByCountry map[string]int   `json:"byCountry"`
			Quality   playback.Quality `json:"quality"`
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
		// Player reports from the last five minutes, per room and for every room together.
		for i := range list {
			q, err := s.Playback.Of(r.Context(), list[i].ID, now.Add(-5*time.Minute))
			if err != nil {
				fail(w, err)
				return
			}
			q.Countries = nil
			list[i].Quality = q
		}
		all, err := s.Playback.Of(r.Context(), "", now.Add(-5*time.Minute))
		if err != nil {
			fail(w, err)
			return
		}
		sort.SliceStable(list, func(i, j int) bool { return list[i].Watching > list[j].Watching })
		writeJSON(w, http.StatusOK, map[string]any{"playing": list, "quality": all})
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
		if err == nil && hidden && s.Hub != nil {
			s.Hub.Takedown(r.PathValue("showtime"), []int64{id})
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
	// Brand protection (Figma 117:1216).
	mux.HandleFunc("GET /v1/me/exec/brand", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		b, err := s.Exec.Brand(r.Context(), a.Email, time.Now())
		reply(w, b, err)
	}))
	// Partners view (Figma 51:198).
	mux.HandleFunc("GET /v1/me/exec/partner", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		p, err := s.Exec.Partner(r.Context(), a.Email, r.URL.Query().Get("as"), time.Now())
		reply(w, p, err)
	}))
	mux.HandleFunc("PUT /v1/me/exec/partner", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var d exec.Deal
		if !decode(w, r, &d) {
			return
		}
		reply(w, map[string]bool{"saved": true}, s.Exec.SaveDeal(r.Context(), a.Email, d))
	}))
	// Notifications and re-engagement (Figma 51:375): the CEO and the CMO.
	mux.HandleFunc("GET /v1/me/exec/campaigns", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		p, err := s.Exec.Campaigns(r.Context(), a.Email, time.Now())
		reply(w, p, err)
	}))
	mux.HandleFunc("POST /v1/me/exec/campaigns", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b struct {
			exec.Campaign
			Texts []exec.Text `json:"texts"`
		}
		if !decode(w, r, &b) {
			return
		}
		c, err := s.Exec.SaveCampaign(r.Context(), a.Email, b.Campaign, b.Texts, time.Now())
		reply(w, c, err)
	}))
	mux.HandleFunc("POST /v1/me/exec/campaigns/{id}/test", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil {
			fail(w, exec.ErrNotFound)
			return
		}
		b, err := s.Exec.TestCampaign(r.Context(), a.Email, id, time.Now())
		reply(w, b, err)
	}))
	mux.HandleFunc("POST /v1/me/exec/campaigns/{id}/cancel", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil {
			fail(w, exec.ErrNotFound)
			return
		}
		reply(w, map[string]bool{"cancelled": true}, s.Exec.CancelCampaign(r.Context(), a.Email, id))
	}))
	// The web service sends due campaigns every minute and reports the emails it sent.
	mux.HandleFunc("POST /v1/exec-campaigns/due", s.internal(func(w http.ResponseWriter, r *http.Request) {
		b, err := s.Exec.DueCampaigns(r.Context(), time.Now())
		reply(w, map[string]any{"batches": b}, err)
	}))
	mux.HandleFunc("POST /v1/exec-campaigns/{id}/emailed", s.internal(func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		var b struct {
			Count int `json:"count"`
		}
		if err != nil || !decode(w, r, &b) {
			if err != nil {
				fail(w, exec.ErrNotFound)
			}
			return
		}
		reply(w, map[string]bool{"ok": true}, s.Exec.CampaignEmailed(r.Context(), id, b.Count))
	}))
	// 18+ recipients (Figma 49:1577, 99:1362), CEO only.
	mux.HandleFunc("GET /v1/me/exec/recipients", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		p, err := s.Exec.Recipients(r.Context(), a.Email, time.Now())
		reply(w, p, err)
	}))
	mux.HandleFunc("PUT /v1/me/exec/recipients", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b exec.AdultRecipient
		if !decode(w, r, &b) {
			return
		}
		out, err := s.Exec.SaveRecipient(r.Context(), a.Email, b)
		reply(w, out, err)
	}))
	mux.HandleFunc("PUT /v1/me/exec/recipients/{id}/status", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b struct {
			Status string `json:"status"`
		}
		if !decode(w, r, &b) {
			return
		}
		reply(w, map[string]string{"status": b.Status}, s.Exec.SetRecipientStatus(r.Context(), a.Email, r.PathValue("id"), b.Status))
	}))
	// Stakeholder view (Figma 83:958).
	mux.HandleFunc("GET /v1/me/exec/stakeholder", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		st, err := s.Exec.Stakeholder(r.Context(), a.Email, time.Now())
		reply(w, st, err)
	}))
	mux.HandleFunc("PUT /v1/me/exec/stakeholder/note", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b struct {
			Body string `json:"body"`
		}
		if !decode(w, r, &b) {
			return
		}
		reply(w, map[string]string{"body": b.Body}, s.Exec.SetNote(r.Context(), a.Email, b.Body))
	}))
	mux.HandleFunc("POST /v1/me/exec/stakeholder/docs", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b struct {
			Name  string `json:"name"`
			Key   string `json:"key"`
			Bytes int64  `json:"bytes"`
		}
		if !decode(w, r, &b) {
			return
		}
		d, err := s.Exec.AddDoc(r.Context(), a.Email, b.Name, b.Key, b.Bytes)
		reply(w, d, err)
	}))
	mux.HandleFunc("GET /v1/me/exec/stakeholder/docs/{id}", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		key, name, err := s.Exec.DocKey(r.Context(), a.Email, r.PathValue("id"))
		reply(w, map[string]string{"key": key, "name": name}, err)
	}))
	mux.HandleFunc("DELETE /v1/me/exec/stakeholder/docs/{id}", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		reply(w, map[string]bool{"deleted": true}, s.Exec.DeleteDoc(r.Context(), a.Email, r.PathValue("id")))
	}))
	// Investor view (Figma 50:609).
	mux.HandleFunc("GET /v1/me/exec/investor", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		in, err := s.Exec.Investor(r.Context(), a.Email, time.Now())
		reply(w, in, err)
	}))
	mux.HandleFunc("PUT /v1/me/exec/milestones", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var m exec.Milestone
		if !decode(w, r, &m) {
			return
		}
		out, err := s.Exec.SaveMilestone(r.Context(), a.Email, m)
		reply(w, out, err)
	}))
	mux.HandleFunc("DELETE /v1/me/exec/milestones/{id}", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil {
			fail(w, exec.ErrNotFound)
			return
		}
		reply(w, map[string]bool{"deleted": true}, s.Exec.DeleteMilestone(r.Context(), a.Email, id))
	}))
	// Infrastructure (Figma 50:469).
	mux.HandleFunc("GET /v1/me/exec/infra", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		in, err := s.Exec.Infra(r.Context(), a.Email, time.Now())
		in.P50Ms, in.P99Ms, in.Requests = s.lat.percentiles()
		if err == nil {
			in.Stream, err = s.Playback.Of(r.Context(), "", time.Now().Add(-24*time.Hour))
		}
		reply(w, in, err)
	}))
	// Security operations (Figma 117:1773).
	mux.HandleFunc("GET /v1/me/exec/security", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		sec, err := s.Exec.Security(r.Context(), a.Email, time.Now())
		reply(w, sec, err)
	}))
	mux.HandleFunc("PUT /v1/me/exec/security/lockdown", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b struct {
			On bool `json:"on"`
		}
		if !decode(w, r, &b) {
			return
		}
		reply(w, map[string]bool{"lockdown": b.On}, s.Exec.SetLockdown(r.Context(), a.Email, b.On))
	}))
	mux.HandleFunc("POST /v1/me/exec/security/incidents", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var in exec.Incident
		if !decode(w, r, &in) {
			return
		}
		out, err := s.Exec.LogIncident(r.Context(), a.Email, in)
		reply(w, out, err)
	}))
	mux.HandleFunc("PUT /v1/me/exec/security/incidents/{id}", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil {
			fail(w, exec.ErrBadInput)
			return
		}
		var b struct {
			Closed bool `json:"closed"`
		}
		if !decode(w, r, &b) {
			return
		}
		reply(w, map[string]bool{"closed": b.Closed}, s.Exec.CloseIncident(r.Context(), a.Email, id, b.Closed))
	}))
	// Licensing (Figma 117:1481).
	mux.HandleFunc("GET /v1/me/exec/licensing", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		if err := s.Exec.CanLicensing(r.Context(), a.Email); err != nil {
			fail(w, err)
			return
		}
		b, err := s.Licensing.Book(r.Context(), time.Now())
		reply(w, b, err)
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
