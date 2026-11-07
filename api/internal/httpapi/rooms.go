package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"net/http"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
	"github.com/Bolajiomo99/E-Cinema/api/internal/notify"
	"github.com/Bolajiomo99/E-Cinema/api/internal/rooms"
)

func (s *Server) roomRoutes(mux *http.ServeMux) {
	// Everything the room page needs in one call: the screening, whether the viewer may
	// enter, their watermark code and the chat so far.
	mux.HandleFunc("GET /v1/rooms/{id}", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, sid string) {
		id := r.PathValue("id")
		st, err := s.Tickets.Get(r.Context(), id)
		if err != nil {
			fail(w, err)
			return
		}
		ok, err := s.Tickets.HasTicket(r.Context(), id, a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		out := map[string]any{"showtime": st, "hasTicket": ok, "serverTime": time.Now().UTC()}
		if ok {
			// One device per seat: the film is not handed to a second device while the seat plays elsewhere.
			if away, err := s.secondDevice(r.Context(), id, a, sid); err != nil {
				fail(w, err)
				return
			} else if away {
				out["elsewhere"] = true
				writeJSON(w, http.StatusOK, out)
				return
			}
			msgs, err := s.Rooms.Recent(r.Context(), id, a.ID, 50)
			if err != nil {
				fail(w, err)
				return
			}
			out["messages"] = msgs
			out["viewerCode"] = rooms.ViewerCode(s.Passes.Key, a.ID)
			out["watching"] = s.Hub.Count(id)
			if err := s.addPanel(r.Context(), out, id, a.ID); err != nil {
				fail(w, err)
				return
			}
		}
		writeJSON(w, http.StatusOK, out)
	}))
	mux.HandleFunc("POST /v1/rooms/{id}/pass", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, sid string) {
		id := r.PathValue("id")
		prof, err := s.Accounts.Active(r.Context(), a.ID, sid)
		if err != nil {
			fail(w, err)
			return
		}
		if prof.Kind == "kids" {
			var adult bool
			if err := s.Accounts.DB.QueryRow(r.Context(), `SELECT adult FROM showtimes WHERE id = $1`, id).Scan(&adult); err == nil && adult {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "This film is not for kids profiles."})
				return
			}
			if err := accounts.CanWatch(prof, time.Now()); err != nil {
				fail(w, err)
				return
			}
		}
		ok, err := s.Tickets.HasTicket(r.Context(), id, a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		if !ok {
			fail(w, rooms.ErrNoTicket)
			return
		}
		if blocked, err := s.secondDevice(r.Context(), id, a, sid); err != nil {
			fail(w, err)
			return
		} else if blocked {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "This ticket is already playing on another device. A ticket plays on one device at a time.", "code": "second_device"})
			return
		}
		name := a.Name
		if prof.Kind != "owner" {
			name = prof.Name
		}
		if name == "" {
			name = "Guest"
		}
		exp := time.Now().Add(rooms.PassFor)
		country, lang, partyID := "", "", ""
		if p, err := s.Accounts.GetProfile(r.Context(), a.ID); err == nil {
			country, lang = p.Country, p.AppLanguage
		}
		if p, err := s.Rooms.PartyFor(r.Context(), id, a.ID); err != nil {
			fail(w, err)
			return
		} else if p != nil {
			partyID = p.ID
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"pass":      s.Passes.Issue(rooms.Pass{AccountID: a.ID, ShowtimeID: id, Name: name, Expires: exp, Country: country, Lang: lang, PartyID: partyID, Quiet: prof.Kind == "kids" && !prof.Chat, SessionID: sid}),
			"expiresAt": exp.UTC(),
		})
	}))
	// Before refunding on PayPal, the web app checks the seat is the viewer's own and still cancellable.
	mux.HandleFunc("POST /v1/me/holds/{id}/cancel", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		c, err := s.Tickets.CanCancel(r.Context(), a.ID, r.PathValue("id"))
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, c)
	}))
	// The viewer's own seats: paid tickets and holds waiting for PayPal approval.
	mux.HandleFunc("GET /v1/me/tickets", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		list, err := s.Tickets.Mine(r.Context(), a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, list)
	}))
	mux.HandleFunc("DELETE /v1/me/holds/{id}", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		if err := s.Tickets.ReleaseMine(r.Context(), a.ID, r.PathValue("id")); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	// Public audience numbers for the "N watching · N countries" badges. Counts only, no people.
	mux.HandleFunc("GET /v1/live", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=5")
		writeJSON(w, http.StatusOK, s.Hub.Stats())
	})
	// Paid seats for the next 24 hours by home country, for the world map's "Tonight" view.
	mux.HandleFunc("GET /v1/audience/tonight", func(w http.ResponseWriter, r *http.Request) {
		list, err := s.Tickets.Tonight(r.Context())
		if err != nil {
			fail(w, err)
			return
		}
		w.Header().Set("Cache-Control", "public, max-age=30")
		writeJSON(w, http.StatusOK, list)
	})
	mux.Handle("GET /v1/rooms/{id}/live", s.Hub.Live(s.Rooms, s.Passes, s.AllowedOrigins))
}

// secondDevice reports whether this device must wait because the account's seats are already
// playing on other devices (one device per paid seat). The owner is emailed once per blocked
// device and screening (email 28, Figma 127:105).
func (s *Server) secondDevice(ctx context.Context, showtime string, a accounts.Account, sid string) (bool, error) {
	others := 0
	var playing string
	for _, x := range s.Hub.SessionsOf(showtime, a.ID) {
		if x != sid {
			others++
			playing = x
		}
	}
	if others == 0 {
		return false, nil
	}
	var seats int
	var film string
	if err := s.Tickets.DB.QueryRow(ctx, `SELECT coalesce(sum(h.seats), 0)::int, s.film FROM showtimes s
	  LEFT JOIN holds h ON h.showtime_id = s.id AND h.account_id = $2 AND h.status = 'paid' WHERE s.id = $1 GROUP BY s.film`, showtime, a.ID).Scan(&seats, &film); err != nil {
		return false, err
	}
	if others < seats {
		return false, nil
	}
	var device, other string
	_ = s.Tickets.DB.QueryRow(ctx, `SELECT coalesce((SELECT device FROM account_sessions WHERE id::text = $1), ''), coalesce((SELECT device FROM account_sessions WHERE id::text = $2), '')`, sid, playing).Scan(&device, &other)
	if device == "" {
		device = "another device"
	}
	if other == "" {
		other = "your other device"
	}
	sum := sha256.Sum256([]byte(sid))
	code := fmt.Sprintf("DEV-%04d", binary.BigEndian.Uint16(sum[:2])%10000)
	_ = s.Notify.Queue(ctx, notify.Mail{Kind: "second_device", To: a.Email, Name: a.Name, Dedupe: "second-device:" + showtime + ":" + sid,
		Data: map[string]any{"film": film, "showtimeId": showtime, "device": device, "playing": other, "code": code}})
	return true, nil
}
