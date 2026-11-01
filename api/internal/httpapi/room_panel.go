package httpapi

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
	"github.com/Bolajiomo99/E-Cinema/api/internal/rooms"
)

// addPanel fills in the room side panel (Figma 17:562): the viewer's party and its chat,
// who of their party is here, the polls and their talk time.
func (s *Server) addPanel(ctx context.Context, out map[string]any, showtimeID, accountID string) error {
	party, err := s.Rooms.PartyFor(ctx, showtimeID, accountID)
	if err != nil {
		return err
	}
	partyID := ""
	if party != nil {
		partyID = party.ID
		online := s.Hub.OnlineIn(showtimeID, party.ID)
		for i := range party.Members {
			party.Members[i].Online = online[party.Members[i].AccountID]
		}
		msgs, err := s.Rooms.RecentParty(ctx, showtimeID, accountID, party.ID, 50)
		if err != nil {
			return err
		}
		out["party"] = party
		out["roomMessages"] = msgs
	}
	polls, err := s.Rooms.Polls(ctx, showtimeID, partyID, accountID)
	if err != nil {
		return err
	}
	out["polls"] = polls
	plan := "free"
	if p, err := s.Accounts.GetProfile(ctx, accountID); err == nil {
		plan = p.Plan
		out["lang"] = p.AppLanguage
	}
	left, err := s.Rooms.TalkLeft(ctx, showtimeID, accountID, plan)
	if err != nil {
		return err
	}
	out["talkLeft"] = left
	return nil
}

func (s *Server) roomPanelRoutes(mux *http.ServeMux) {
	// A cheap check for the web app's room routes: may this viewer use the room, and in which language do they read.
	mux.HandleFunc("GET /v1/rooms/{id}/access", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		ok, err := s.Tickets.HasTicket(r.Context(), r.PathValue("id"), a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		out := map[string]any{"hasTicket": ok, "accountId": a.ID, "lang": "en"}
		if p, err := s.Accounts.GetProfile(r.Context(), a.ID); err == nil && p.AppLanguage != "" {
			out["lang"] = p.AppLanguage
		}
		writeJSON(w, http.StatusOK, out)
	}))
	// A voice note, photo or file the web app has already stored, posted on the viewer's behalf.
	// Voice notes spend talk time; free members are refused once theirs is used up.
	mux.HandleFunc("POST /v1/internal/rooms/{id}/media", s.internal(func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var b struct {
			AccountID string          `json:"accountId"`
			Scope     string          `json:"scope"`
			Kind      string          `json:"kind"`
			Body      string          `json:"body"`
			Media     json.RawMessage `json:"media"`
			Seconds   int             `json:"seconds"`
		}
		if !decode(w, r, &b) {
			return
		}
		ok, err := s.Tickets.HasTicket(r.Context(), id, b.AccountID)
		if err != nil {
			fail(w, err)
			return
		}
		if !ok {
			fail(w, rooms.ErrNoTicket)
			return
		}
		if b.Kind != "voice" && b.Kind != "image" && b.Kind != "file" {
			fail(w, rooms.ErrEmpty)
			return
		}
		var name string
		if err := s.Rooms.DB.QueryRow(r.Context(), `SELECT name FROM accounts WHERE id = $1`, b.AccountID).Scan(&name); err != nil {
			fail(w, err)
			return
		}
		prof, _ := s.Accounts.GetProfile(r.Context(), b.AccountID)
		x := rooms.Extra{Kind: b.Kind, Media: b.Media, Lang: prof.AppLanguage, Country: prof.Country}
		if b.Scope == "room" {
			p, err := s.Rooms.PartyFor(r.Context(), id, b.AccountID)
			if err != nil {
				fail(w, err)
				return
			}
			if p == nil {
				fail(w, rooms.ErrNoParty)
				return
			}
			x.PartyID = p.ID
		}
		left := -1
		if b.Kind == "voice" {
			plan := prof.Plan
			if plan == "" {
				plan = "free"
			}
			if left, err = s.Rooms.UseTalk(r.Context(), id, b.AccountID, plan, b.Seconds); err != nil {
				fail(w, err)
				return
			}
		}
		if name == "" {
			name = "Guest"
		}
		m, err := s.Rooms.PostWith(r.Context(), id, b.AccountID, name, b.Body, x)
		if err != nil {
			fail(w, err)
			return
		}
		s.Hub.Publish(id, m, b.AccountID)
		writeJSON(w, http.StatusOK, map[string]any{"message": m, "talkLeft": left})
	}))
	// Translations for the world chat: what is stored, and what still needs translating.
	mux.HandleFunc("POST /v1/internal/rooms/{id}/translations", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Lang string  `json:"lang"`
			IDs  []int64 `json:"ids"`
		}
		if !decode(w, r, &b) {
			return
		}
		if len(b.IDs) > 100 {
			b.IDs = b.IDs[:100]
		}
		done, missing, err := s.Rooms.Translations(r.Context(), r.PathValue("id"), b.Lang, b.IDs)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"done": done, "missing": missing})
	}))
	mux.HandleFunc("PUT /v1/internal/rooms/{id}/translations", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Lang  string             `json:"lang"`
			Items []rooms.Translated `json:"items"`
		}
		if !decodeLarge(w, r, &b) {
			return
		}
		if err := s.Rooms.SaveTranslations(r.Context(), r.PathValue("id"), b.Lang, b.Items); err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"saved": len(b.Items)})
	}))
}
