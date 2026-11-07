package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
	"github.com/Bolajiomo99/E-Cinema/api/internal/notify"
	"github.com/Bolajiomo99/E-Cinema/api/internal/rooms"
	"github.com/Bolajiomo99/E-Cinema/api/internal/studios"
)

// The studio portal (Figma "06 Studio Portal"): onboarding, team, overview, films and payouts.
func (s *Server) studioRoutes(mux *http.ServeMux) {
	type mine = func(w http.ResponseWriter, r *http.Request, a accounts.Account)
	on := func(fn mine) http.HandlerFunc {
		return s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) { fn(w, r, a) })
	}
	withSteps := func(w http.ResponseWriter, a accounts.Account, st studios.Studio, err error) {
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"studio": st, "steps": st.Steps(), "identityOk": a.IDVerified && a.FaceVerified})
	}

	// Published studio premieres, for the web app's catalog. Public facts only.
	mux.HandleFunc("GET /v1/studio-films", func(w http.ResponseWriter, r *http.Request) {
		list, err := s.Studios.LiveFilms(r.Context())
		reply(w, map[string]any{"films": list}, err)
	})
	mux.HandleFunc("GET /v1/studio-films/{upload}/poster", func(w http.ResponseWriter, r *http.Request) {
		key, err := s.Studios.LivePosterKey(r.Context(), r.PathValue("upload"))
		reply(w, map[string]string{"key": key}, err)
	})

	mux.HandleFunc("GET /v1/me/studio", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		st, err := s.Studios.Mine(r.Context(), a.ID, a.Email)
		if err == studios.ErrNotFound {
			writeJSON(w, http.StatusOK, map[string]any{"studio": nil, "identityOk": a.IDVerified && a.FaceVerified})
			return
		}
		withSteps(w, a, st, err)
	}))
	mux.HandleFunc("PUT /v1/me/studio", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var d studios.Draft
		if decodeN(w, r, 4<<10, &d) {
			st, err := s.Studios.Save(r.Context(), a.ID, a.Email, d)
			withSteps(w, a, st, err)
		}
	}))
	mux.HandleFunc("PUT /v1/me/studio/docs", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b struct {
			Key string
			OK  bool
		}
		if decodeN(w, r, 2<<10, &b) {
			st, err := s.Studios.SetDocs(r.Context(), a.ID, a.Email, b.Key, b.OK)
			withSteps(w, a, st, err)
		}
	}))
	mux.HandleFunc("PUT /v1/me/studio/payout", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var p studios.Payout
		if decodeN(w, r, 2<<10, &p) {
			st, err := s.Studios.SetPayout(r.Context(), a.ID, a.Email, p)
			withSteps(w, a, st, err)
		}
	}))
	mux.HandleFunc("PUT /v1/me/studio/rights", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b struct{ Note string }
		if decodeN(w, r, 8<<10, &b) {
			st, err := s.Studios.DeclareRights(r.Context(), a.ID, a.Email, b.Note)
			withSteps(w, a, st, err)
		}
	}))
	mux.HandleFunc("POST /v1/me/studio/terms", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		st, err := s.Studios.AcceptTerms(r.Context(), a.ID, a.Email)
		withSteps(w, a, st, err)
	}))
	mux.HandleFunc("POST /v1/me/studio/submit", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		if !a.IDVerified || !a.FaceVerified {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "Verify your face and ID first, so we know who runs this studio"})
			return
		}
		st, err := s.Studios.Submit(r.Context(), a.ID, a.Email)
		withSteps(w, a, st, err)
	}))

	mux.HandleFunc("GET /v1/me/studio/overview", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		o, err := s.Studios.Overview(r.Context(), a.ID, a.Email, time.Now())
		reply(w, o, err)
	}))
	mux.HandleFunc("GET /v1/me/studio/analytics", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		days, _ := strconv.Atoi(r.URL.Query().Get("days"))
		v, err := s.Studios.Analytics(r.Context(), a.ID, a.Email, days, time.Now())
		reply(w, v, err)
	}))
	mux.HandleFunc("GET /v1/me/studio/films", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		f, err := s.Studios.Films(r.Context(), a.ID, a.Email)
		reply(w, map[string]any{"films": f}, err)
	}))
	mux.HandleFunc("GET /v1/me/studio/payouts", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		st, p, err := s.Studios.Payouts(r.Context(), a.ID, a.Email)
		reply(w, map[string]any{"studio": st, "payouts": p}, err)
	}))
	mux.HandleFunc("GET /v1/me/studio/team", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		t, err := s.Studios.Team(r.Context(), a.ID, a.Email)
		reply(w, map[string]any{"members": t, "roles": studios.Roles}, err)
	}))
	mux.HandleFunc("PUT /v1/me/studio/team", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b struct{ Email, Role string }
		if decodeN(w, r, 1<<10, &b) {
			err := s.Studios.SetMember(r.Context(), a.ID, a.Email, b.Email, b.Role)
			if err == nil {
				t, err2 := s.Studios.Team(r.Context(), a.ID, a.Email)
				reply(w, map[string]any{"members": t, "roles": studios.Roles}, err2)
				return
			}
			fail(w, err)
		}
	}))
	mux.HandleFunc("POST /v1/me/studio/team/remove", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b struct{ Email string }
		if decodeN(w, r, 1<<10, &b) {
			if err := s.Studios.RemoveMember(r.Context(), a.ID, a.Email, b.Email); err != nil {
				fail(w, err)
				return
			}
			t, err := s.Studios.Team(r.Context(), a.ID, a.Email)
			reply(w, map[string]any{"members": t, "roles": studios.Roles}, err)
		}
	}))

	// Film uploads (Figma 35:290). The web app moves the bytes; these routes keep the record.
	mux.HandleFunc("GET /v1/me/studio/uploads", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		u, err := s.Studios.Uploads(r.Context(), a.ID, a.Email)
		reply(w, map[string]any{"uploads": u}, err)
	}))
	mux.HandleFunc("POST /v1/me/studio/uploads", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b struct{ Title string }
		if decodeN(w, r, 1<<10, &b) {
			u, err := s.Studios.CreateUpload(r.Context(), a.ID, a.Email, b.Title)
			reply(w, map[string]any{"upload": u}, err)
		}
	}))
	mux.HandleFunc("GET /v1/me/studio/uploads/{id}", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		u, err := s.Studios.Upload(r.Context(), a.ID, a.Email, r.PathValue("id"))
		reply(w, map[string]any{"upload": u}, err)
	}))
	mux.HandleFunc("PUT /v1/me/studio/uploads/{id}", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b struct{ Title string }
		if decodeN(w, r, 1<<10, &b) {
			u, err := s.Studios.RenameUpload(r.Context(), a.ID, a.Email, r.PathValue("id"), b.Title)
			reply(w, map[string]any{"upload": u}, err)
		}
	}))
	mux.HandleFunc("PUT /v1/me/studio/uploads/{id}/details", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var d studios.Details
		if decodeN(w, r, 4<<10, &d) {
			u, err := s.Studios.SaveDetails(r.Context(), a.ID, a.Email, r.PathValue("id"), d)
			reply(w, map[string]any{"upload": u}, err)
		}
	}))
	mux.HandleFunc("PUT /v1/me/studio/uploads/{id}/poster", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b struct{ Key string }
		if decodeN(w, r, 1<<10, &b) {
			u, err := s.Studios.SetPoster(r.Context(), a.ID, a.Email, r.PathValue("id"), b.Key)
			reply(w, map[string]any{"upload": u}, err)
		}
	}))
	mux.HandleFunc("GET /v1/me/studio/uploads/{id}/premiere", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		p, err := s.Studios.Premiere(r.Context(), a.ID, a.Email, r.PathValue("id"))
		reply(w, map[string]any{"premiere": p}, err)
	}))
	mux.HandleFunc("PUT /v1/me/studio/uploads/{id}/premiere", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var in studios.PremiereInput
		if decodeN(w, r, 64<<10, &in) {
			p, err := s.Studios.SavePremiere(r.Context(), a.ID, a.Email, r.PathValue("id"), in, time.Now())
			reply(w, map[string]any{"premiere": p}, err)
		}
	}))
	// Danger zone (Figma 99:247): the premiere's real pre-sales, moving it and withdrawing it.
	mux.HandleFunc("GET /v1/me/studio/uploads/{id}/plan", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		p, err := s.Studios.PlanOf(r.Context(), a.ID, a.Email, r.PathValue("id"))
		reply(w, map[string]any{"plan": p}, err)
	}))
	mux.HandleFunc("GET /v1/me/studio/uploads/{id}/sales", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		v, err := s.Studios.SalesOf(r.Context(), a.ID, a.Email, r.PathValue("id"), time.Now())
		reply(w, map[string]any{"sales": v}, err)
	}))
	mux.HandleFunc("POST /v1/me/studio/uploads/{id}/reschedule", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b struct{ StartsAt time.Time }
		if decodeN(w, r, 1<<10, &b) {
			p, err := s.Studios.Reschedule(r.Context(), a.ID, a.Email, r.PathValue("id"), b.StartsAt, time.Now())
			reply(w, map[string]any{"plan": p}, err)
		}
	}))
	mux.HandleFunc("POST /v1/me/studio/uploads/{id}/withdraw", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		p, err := s.Studios.Withdraw(r.Context(), a.ID, a.Email, r.PathValue("id"), time.Now())
		reply(w, map[string]any{"plan": p}, err)
	}))
	// Seats of withdrawn premieres waiting for their refund (the web app pays them back).
	mux.HandleFunc("POST /v1/refunds/due", s.internal(func(w http.ResponseWriter, r *http.Request) {
		list, err := s.Studios.RefundsDue(r.Context(), 20)
		reply(w, map[string]any{"refunds": list}, err)
	}))
	mux.HandleFunc("POST /v1/refunds/{id}/free", s.internal(func(w http.ResponseWriter, r *http.Request) {
		reply(w, map[string]bool{"ok": true}, s.Studios.SettleFreeSeat(r.Context(), r.PathValue("id")))
	}))
	mux.HandleFunc("POST /v1/refunds/{id}/credit", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var acct string
		if err := s.Studios.DB.QueryRow(r.Context(), `SELECT account_id::text FROM holds WHERE id = $1 AND refund_due`, r.PathValue("id")).Scan(&acct); err != nil {
			fail(w, studios.ErrNotFound)
			return
		}
		_, err := s.Gifts.RefundCredit(r.Context(), acct, r.PathValue("id"))
		if err == nil {
			_ = s.Notify.RefundedHold(r.Context(), r.PathValue("id"))
		}
		reply(w, map[string]bool{"ok": true}, err)
	}))
	// Notifications (Figma 99:552).
	mux.HandleFunc("GET /v1/me/studio/notices", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		n, err := s.Studios.Notices(r.Context(), a.ID, a.Email, time.Now())
		reply(w, n, err)
	}))
	mux.HandleFunc("POST /v1/me/studio/notices/seen", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		reply(w, map[string]bool{"ok": true}, s.Studios.SeeNotices(r.Context(), a.ID, a.Email, time.Now()))
	}))
	// Coming-soon posts (Figma 53:1512).
	mux.HandleFunc("PUT /v1/me/studio/uploads/{id}/coming-soon", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var in studios.ComingSoonInput
		if decodeN(w, r, 2<<10, &in) {
			p, err := s.Studios.SaveComingSoon(r.Context(), a.ID, a.Email, r.PathValue("id"), in)
			reply(w, map[string]any{"premiere": p}, err)
		}
	}))
	// AI dubbing (Figma 35:871).
	mux.HandleFunc("GET /v1/me/studio/uploads/{id}/dubs", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		d, err := s.Studios.Dubs(r.Context(), a.ID, a.Email, r.PathValue("id"))
		reply(w, map[string]any{"dubs": d}, err)
	}))
	mux.HandleFunc("POST /v1/me/studio/uploads/{id}/dubs", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b struct{ Lang string }
		if decodeN(w, r, 1<<10, &b) {
			d, err := s.Studios.StartDub(r.Context(), a.ID, a.Email, r.PathValue("id"), b.Lang)
			reply(w, map[string]any{"dub": d}, err)
		}
	}))
	mux.HandleFunc("GET /v1/me/studio/uploads/{id}/dubs/{lang}", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		d, lines, err := s.Studios.DubLines(r.Context(), a.ID, a.Email, r.PathValue("id"), r.PathValue("lang"))
		reply(w, map[string]any{"dub": d, "lines": lines}, err)
	}))
	mux.HandleFunc("PUT /v1/me/studio/uploads/{id}/dubs/{lang}", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b studios.DubSettings
		if decodeN(w, r, 1<<10, &b) {
			d, err := s.Studios.SetDub(r.Context(), a.ID, a.Email, r.PathValue("id"), r.PathValue("lang"), b)
			reply(w, map[string]any{"dub": d}, err)
		}
	}))
	mux.HandleFunc("DELETE /v1/me/studio/uploads/{id}/dubs/{lang}", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		keys, err := s.Studios.RemoveDub(r.Context(), a.ID, a.Email, r.PathValue("id"), r.PathValue("lang"))
		reply(w, map[string]any{"keys": keys}, err)
	}))
	mux.HandleFunc("PUT /v1/me/studio/uploads/{id}/dubs/{lang}/lines/{idx}", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b struct {
			Text      string
			ClearFlag bool
		}
		idx, convErr := strconv.Atoi(r.PathValue("idx"))
		if convErr != nil {
			fail(w, studios.ErrNotFound)
			return
		}
		if decodeN(w, r, 4<<10, &b) {
			l, err := s.Studios.EditLine(r.Context(), a.ID, a.Email, r.PathValue("id"), r.PathValue("lang"), idx, b.Text, b.ClearFlag)
			reply(w, map[string]any{"line": l}, err)
		}
	}))
	mux.HandleFunc("POST /v1/me/studio/uploads/{id}/dubs/{lang}/voice", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		d, err := s.Studios.Voice(r.Context(), a.ID, a.Email, r.PathValue("id"), r.PathValue("lang"))
		reply(w, map[string]any{"dub": d}, err)
	}))
	mux.HandleFunc("POST /v1/me/studio/uploads/{id}/dubs/{lang}/approve", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		d, err := s.Studios.Approve(r.Context(), a.ID, a.Email, r.PathValue("id"), r.PathValue("lang"))
		reply(w, map[string]any{"dub": d}, err)
	}))
	// Live control room (Figma 37:1272): the audience of the film's premiere, right now.
	mux.HandleFunc("GET /v1/me/studio/uploads/{id}/control", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		sid, studio, err := s.Studios.LiveShowtime(r.Context(), a.ID, a.Email, r.PathValue("id"), false)
		if err != nil {
			fail(w, err)
			return
		}
		c, err := s.Rooms.Control(r.Context(), sid)
		if errors.Is(err, rooms.ErrNoMessage) {
			err = studios.ErrNotFound
		}
		reply(w, map[string]any{"control": c, "live": s.Hub.StatOf(sid), "peak": s.Hub.PeakOf(sid), "studio": studio}, err)
	}))
	mux.HandleFunc("POST /v1/me/studio/uploads/{id}/control/announce", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b struct{ Text string }
		if !decodeN(w, r, 2<<10, &b) {
			return
		}
		sid, studio, err := s.Studios.LiveShowtime(r.Context(), a.ID, a.Email, r.PathValue("id"), true)
		if err != nil {
			fail(w, err)
			return
		}
		text := strings.TrimSpace(b.Text)
		if text == "" || utf8.RuneCountInString(text) > 280 {
			fail(w, studios.ErrBadInput)
			return
		}
		if !announceAllowed(sid) {
			writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "One message a minute: wait a moment and send again"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]int{"reached": s.Hub.Announce(sid, studio, text)})
	}))
	mux.HandleFunc("POST /v1/me/studio/uploads/{id}/control/moderate", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b struct {
			MessageID int64
			Hide      bool
		}
		if !decodeN(w, r, 1<<10, &b) {
			return
		}
		sid, _, err := s.Studios.LiveShowtime(r.Context(), a.ID, a.Email, r.PathValue("id"), true)
		if err != nil {
			fail(w, err)
			return
		}
		hidden, err := s.Rooms.Moderate(r.Context(), sid, b.MessageID, b.Hide)
		if errors.Is(err, rooms.ErrNoMessage) {
			err = studios.ErrNotFound
		}
		if err == nil && hidden {
			s.Hub.Takedown(sid, []int64{b.MessageID})
		}
		reply(w, map[string]bool{"hidden": hidden}, err)
	}))
	// The web app's dubbing worker.
	mux.HandleFunc("GET /v1/studio-dubs/work", s.internal(func(w http.ResponseWriter, r *http.Request) {
		jobs, err := s.Studios.DubWork(r.Context())
		reply(w, map[string]any{"jobs": jobs}, err)
	}))
	mux.HandleFunc("GET /v1/studio-dubs/{upload}/{lang}", s.internal(func(w http.ResponseWriter, r *http.Request) {
		lines, err := s.Studios.DubJobLines(r.Context(), r.PathValue("upload"), r.PathValue("lang"))
		reply(w, map[string]any{"lines": lines}, err)
	}))
	mux.HandleFunc("PUT /v1/studio-dubs/{upload}/{lang}/lines", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Lines []studios.DubLine }
		if decodeN(w, r, 8<<20, &b) {
			err := s.Studios.SetDubLines(r.Context(), r.PathValue("upload"), r.PathValue("lang"), b.Lines)
			reply(w, map[string]bool{"ok": err == nil}, err)
		}
	}))
	mux.HandleFunc("PUT /v1/studio-dubs/{upload}/{lang}/lines/{idx}", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Text, Flag, AudioKey string }
		idx, convErr := strconv.Atoi(r.PathValue("idx"))
		if convErr != nil {
			fail(w, studios.ErrNotFound)
			return
		}
		if decodeN(w, r, 4<<10, &b) {
			var err error
			if b.AudioKey != "" {
				err = s.Studios.SetLineAudio(r.Context(), r.PathValue("upload"), r.PathValue("lang"), idx, b.Text, b.AudioKey)
			} else {
				err = s.Studios.SetLineDraft(r.Context(), r.PathValue("upload"), r.PathValue("lang"), idx, b.Text, b.Flag)
			}
			reply(w, map[string]bool{"ok": err == nil}, err)
		}
	}))
	mux.HandleFunc("POST /v1/studio-dubs/{upload}/{lang}/finish", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Error string }
		if decodeN(w, r, 2<<10, &b) {
			err := s.Studios.FinishDub(r.Context(), r.PathValue("upload"), r.PathValue("lang"), b.Error)
			reply(w, map[string]bool{"ok": err == nil}, err)
		}
	}))
	mux.HandleFunc("GET /v1/studio-dubs/{upload}", s.internal(func(w http.ResponseWriter, r *http.Request) {
		sid, langs, err := s.Studios.ApprovedDubs(r.Context(), r.PathValue("upload"))
		reply(w, map[string]any{"showtimeId": sid, "langs": langs}, err)
	}))
	mux.HandleFunc("DELETE /v1/me/studio/uploads/{id}", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		err := s.Studios.DeleteUpload(r.Context(), a.ID, a.Email, r.PathValue("id"))
		reply(w, map[string]bool{"ok": err == nil}, err)
	}))
	mux.HandleFunc("POST /v1/me/studio/uploads/{id}/files", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b struct {
			Name string
			Size int64
		}
		if decodeN(w, r, 1<<10, &b) {
			f, err := s.Studios.AddFile(r.Context(), a.ID, a.Email, r.PathValue("id"), b.Name, b.Size)
			reply(w, map[string]any{"file": f}, err)
		}
	}))
	mux.HandleFunc("GET /v1/me/studio/uploads/{id}/files/{file}", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		f, err := s.Studios.File(r.Context(), a.ID, a.Email, r.PathValue("id"), r.PathValue("file"), r.URL.Query().Get("write") == "1")
		reply(w, map[string]any{"file": f}, err)
	}))
	mux.HandleFunc("PUT /v1/me/studio/uploads/{id}/files/{file}", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b studios.FileUpdate
		if decodeN(w, r, 8<<10, &b) {
			f, err := s.Studios.UpdateFile(r.Context(), a.ID, a.Email, r.PathValue("id"), r.PathValue("file"), b)
			reply(w, map[string]any{"file": f}, err)
		}
	}))
	mux.HandleFunc("DELETE /v1/me/studio/uploads/{id}/files/{file}", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		err := s.Studios.RemoveFile(r.Context(), a.ID, a.Email, r.PathValue("id"), r.PathValue("file"))
		reply(w, map[string]bool{"ok": err == nil}, err)
	}))

	// Marketing (Figma 39:779): tracked campaign links and AI clip moments.
	mux.HandleFunc("GET /v1/me/studio/campaigns", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		c, err := s.Studios.Campaigns(r.Context(), a.ID, a.Email)
		reply(w, map[string]any{"campaigns": c}, err)
	}))
	mux.HandleFunc("POST /v1/me/studio/campaigns", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var in studios.CampaignInput
		if decodeN(w, r, 2<<10, &in) {
			c, err := s.Studios.CreateCampaign(r.Context(), a.ID, a.Email, in)
			reply(w, c, err)
		}
	}))
	mux.HandleFunc("PUT /v1/me/studio/campaigns/{id}", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b struct{ CostCents int64 }
		if decodeN(w, r, 1<<10, &b) {
			c, err := s.Studios.SetCampaignCost(r.Context(), a.ID, a.Email, r.PathValue("id"), b.CostCents)
			reply(w, c, err)
		}
	}))
	mux.HandleFunc("DELETE /v1/me/studio/campaigns/{id}", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		err := s.Studios.DeleteCampaign(r.Context(), a.ID, a.Email, r.PathValue("id"))
		reply(w, map[string]bool{"ok": err == nil}, err)
	}))
	mux.HandleFunc("GET /v1/me/studio/uploads/{id}/clips", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		c, err := s.Studios.Clips(r.Context(), a.ID, a.Email, r.PathValue("id"))
		reply(w, c, err)
	}))
	mux.HandleFunc("PUT /v1/me/studio/uploads/{id}/clips", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b struct {
			CutoffMs int
			Clips    []studios.Clip
		}
		if decodeN(w, r, 16<<10, &b) {
			c, err := s.Studios.SaveClips(r.Context(), a.ID, a.Email, r.PathValue("id"), b.CutoffMs, b.Clips)
			reply(w, c, err)
		}
	}))
	mux.HandleFunc("POST /v1/me/studio/uploads/{id}/clips/approve", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var b struct{ Idx []int }
		if decodeN(w, r, 1<<10, &b) {
			c, err := s.Studios.ApproveClips(r.Context(), a.ID, a.Email, r.PathValue("id"), b.Idx)
			reply(w, c, err)
		}
	}))
	mux.HandleFunc("POST /v1/campaign-visits/{code}", s.internal(func(w http.ResponseWriter, r *http.Request) {
		sid, err := s.Studios.CampaignVisit(r.Context(), r.PathValue("code"))
		reply(w, map[string]string{"showtimeId": sid}, err)
	}))

	// Piracy protection (Figma 39:578).
	mux.HandleFunc("GET /v1/me/studio/leaks", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		l, stats, err := s.Studios.Leaks(r.Context(), a.ID, a.Email, time.Now())
		reply(w, map[string]any{"leaks": l, "stats": stats}, err)
	}))
	mux.HandleFunc("POST /v1/me/studio/leaks", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var in studios.LeakInput
		if decodeN(w, r, 4<<10, &in) {
			l, err := s.Studios.ReportLeak(r.Context(), a.ID, a.Email, in, func(id string) string { return rooms.ViewerCode(s.Passes.Key, id) })
			reply(w, l, err)
		}
	}))
	mux.HandleFunc("PUT /v1/me/studio/leaks/{id}", on(func(w http.ResponseWriter, r *http.Request, a accounts.Account) {
		var u studios.LeakUpdate
		if decodeN(w, r, 16<<10, &u) {
			l, err := s.Studios.UpdateLeak(r.Context(), a.ID, a.Email, r.PathValue("id"), u)
			reply(w, l, err)
		}
	}))

	// The studio desk, for E-Cinema staff (the web checks STAFF_EMAILS).
	mux.HandleFunc("GET /v1/studios/applications", s.internal(func(w http.ResponseWriter, r *http.Request) {
		a, err := s.Studios.Applications(r.Context())
		reply(w, map[string]any{"studios": a}, err)
	}))
	mux.HandleFunc("GET /v1/studio-bans", s.internal(func(w http.ResponseWriter, r *http.Request) {
		b, err := s.Studios.BanRequests(r.Context())
		reply(w, map[string]any{"requests": b}, err)
	}))
	mux.HandleFunc("POST /v1/studio-bans/{id}", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Approve bool }
		if decodeN(w, r, 1<<10, &b) {
			err := s.Studios.DecideBan(r.Context(), r.PathValue("id"), b.Approve, func(acct, reason string) error { return s.Accounts.Ban(r.Context(), acct, reason) })
			reply(w, map[string]bool{"ok": err == nil}, err)
		}
	}))
	mux.HandleFunc("POST /v1/studios/{slug}/review", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Approve bool
			Note    string
		}
		if decodeN(w, r, 2<<10, &b) {
			err := s.Studios.Review(r.Context(), r.PathValue("slug"), b.Approve, b.Note)
			if err == nil && b.Approve {
				s.studioApproved(r.PathValue("slug"))
			}
			reply(w, map[string]bool{"ok": err == nil}, err)
		}
	}))
}

var announced = struct {
	sync.Mutex
	at map[string]time.Time
}{at: map[string]time.Time{}}

// announceAllowed lets a studio message a screening's viewers once a minute.
func announceAllowed(showtime string) bool {
	announced.Lock()
	defer announced.Unlock()
	if time.Since(announced.at[showtime]) < time.Minute {
		return false
	}
	announced.at[showtime] = time.Now()
	return true
}

// studioApproved queues email 19 (Figma 106:564) to the studio's owner.
func (s *Server) studioApproved(slug string) {
	if s.Studios.DB == nil {
		return
	}
	ctx := context.Background()
	var studio, email string
	if s.Studios.DB.QueryRow(ctx, `SELECT st.name, m.email FROM studios st JOIN studio_members m ON m.studio = st.name AND m.role = 'owner'
	  WHERE st.slug = $1 ORDER BY m.added_at LIMIT 1`, slug).Scan(&studio, &email) != nil {
		return
	}
	_ = s.Notify.Queue(ctx, notify.Mail{Kind: "studio_approved", To: email, Name: studio, Dedupe: "studiook:" + slug, Data: map[string]any{"studio": studio}})
}
