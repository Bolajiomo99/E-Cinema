package httpapi

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
	"github.com/Bolajiomo99/E-Cinema/api/internal/chat"
	"github.com/Bolajiomo99/E-Cinema/api/internal/notify"
	"github.com/Bolajiomo99/E-Cinema/api/internal/rooms"
)

// ChatPassFor is how long a Messages websocket pass works; the page fetches a new one to reconnect.
const ChatPassFor = 10 * time.Minute

// chatShowtime marks a room pass as a Messages pass, so the two can never be swapped.
const chatShowtime = "chat"

// Messages (Figma 32:798) and requests (95:2163).
func (s *Server) chatRoutes(mux *http.ServeMux) {
	others := func(ids []string, me string) []string {
		out := make([]string, 0, len(ids))
		for _, id := range ids {
			if id != me {
				out = append(out, id)
			}
		}
		return out
	}
	mux.HandleFunc("POST /v1/me/chat/pass", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		exp := time.Now().Add(ChatPassFor)
		writeJSON(w, http.StatusOK, map[string]any{"pass": s.Passes.Issue(rooms.Pass{AccountID: a.ID, ShowtimeID: chatShowtime, Name: "chat", Expires: exp}), "expiresAt": exp})
	}))
	mux.Handle("GET /v1/chat/live", s.ChatHub.Live(s.Chat, func(t string) (string, error) {
		p, err := s.Passes.Check(t, chatShowtime, time.Now())
		return p.AccountID, err
	}, s.AllowedOrigins))

	mux.HandleFunc("GET /v1/me/chat", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		list, err := s.Chat.List(r.Context(), a.ID, r.URL.Query().Get("filter"))
		if err != nil {
			fail(w, err)
			return
		}
		ids := []string{}
		for _, c := range list {
			if c.OtherID != "" {
				ids = append(ids, c.OtherID)
			}
		}
		on := map[string]bool{}
		for _, id := range s.ChatHub.Online(ids) {
			on[id] = true
		}
		for i := range list {
			list[i].Online = on[list[i].OtherID]
		}
		reqs, err := s.Chat.Requests(r.Context(), a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"conversations": list, "requests": len(reqs)})
	}))
	mux.HandleFunc("GET /v1/me/chat/unread", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		n, err := s.Chat.Unread(r.Context(), a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		reqs, err := s.Chat.Requests(r.Context(), a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]int{"unread": n, "requests": len(reqs)})
	}))
	mux.HandleFunc("GET /v1/me/chat/search", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		people, err := s.Chat.Search(r.Context(), a.ID, r.URL.Query().Get("q"))
		if err != nil {
			fail(w, err)
			return
		}
		for i := range people {
			people[i].Online = people[i].Friend && s.ChatHub.IsOnline(people[i].ID)
		}
		writeJSON(w, http.StatusOK, map[string]any{"people": people})
	}))
	mux.HandleFunc("GET /v1/me/friends", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		fr, err := s.Chat.Friends(r.Context(), a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		for i := range fr {
			fr[i].Online = s.ChatHub.IsOnline(fr[i].ID)
		}
		writeJSON(w, http.StatusOK, map[string]any{"friends": fr})
	}))
	mux.HandleFunc("GET /v1/me/friends/requests", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		reqs, err := s.Chat.Requests(r.Context(), a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"requests": reqs})
	}))
	mux.HandleFunc("POST /v1/me/friends/requests", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct{ To, Note, Spam string }
		if !decode(w, r, &b) {
			return
		}
		friends, err := s.Chat.SendRequest(r.Context(), a.ID, b.To, b.Note, b.Spam)
		if err != nil {
			fail(w, err)
			return
		}
		if friends {
			_ = s.Notify.Add(r.Context(), b.To, notify.New{Kind: "friend", Title: a.Name + " accepted your friend request", Body: "You can message each other now.", Link: "/messages"})
		} else if b.Spam == "" {
			_ = s.Notify.Add(r.Context(), b.To, notify.New{Kind: "friend", Title: a.Name + " wants to be friends", Body: b.Note, Link: "/messages?tab=requests", Dedupe: "req:" + a.ID})
		}
		s.ChatHub.Send([]string{b.To}, chat.Event{Type: "request", AccountID: a.ID})
		writeJSON(w, http.StatusOK, map[string]bool{"friends": friends})
	}))
	mux.HandleFunc("POST /v1/me/friends/requests/{id}", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct{ Action, Reason string }
		if !decode(w, r, &b) {
			return
		}
		from, err := s.Chat.Decide(r.Context(), a.ID, r.PathValue("id"), b.Action, b.Reason)
		if err != nil {
			fail(w, err)
			return
		}
		if b.Action == "accept" {
			_ = s.Notify.Add(r.Context(), from, notify.New{Kind: "friend", Title: a.Name + " accepted your friend request", Body: "You can message each other now.", Link: "/messages"})
			s.ChatHub.Send([]string{from}, chat.Event{Type: "presence", AccountID: a.ID, On: s.ChatHub.IsOnline(a.ID)})
			s.ChatHub.Send([]string{a.ID}, chat.Event{Type: "presence", AccountID: from, On: s.ChatHub.IsOnline(from)})
		}
		writeJSON(w, http.StatusOK, map[string]string{"from": from})
	}))
	mux.HandleFunc("DELETE /v1/me/friends/{id}", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		if err := s.Chat.Unfriend(r.Context(), a.ID, r.PathValue("id")); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("POST /v1/me/blocks", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct{ ID string }
		if !decode(w, r, &b) {
			return
		}
		if err := s.Chat.Block(r.Context(), a.ID, b.ID); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("POST /v1/me/chat/dm", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct{ FriendID string }
		if !decode(w, r, &b) {
			return
		}
		id, err := s.Chat.OpenDM(r.Context(), a.ID, b.FriendID)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"id": id})
	}))
	mux.HandleFunc("POST /v1/me/chat/groups", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct {
			Name    string   `json:"name"`
			Members []string `json:"members"`
		}
		if !decode(w, r, &b) {
			return
		}
		id, err := s.Chat.CreateGroup(r.Context(), a.ID, b.Name, b.Members)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]string{"id": id})
	}))
	mux.HandleFunc("POST /v1/me/chat/{id}/members", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct {
			Members []string `json:"members"`
		}
		if !decode(w, r, &b) {
			return
		}
		if err := s.Chat.AddToGroup(r.Context(), a.ID, r.PathValue("id"), b.Members); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("DELETE /v1/me/chat/{id}/members/me", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		if err := s.Chat.Leave(r.Context(), a.ID, r.PathValue("id")); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("GET /v1/me/chat/{id}", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		before, _ := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64)
		t, err := s.Chat.Open(r.Context(), a.ID, r.PathValue("id"), before)
		if err != nil {
			fail(w, err)
			return
		}
		ids := make([]string, 0, len(t.Members))
		for i := range t.Members {
			if t.Members[i].ID != a.ID {
				t.Members[i].Online = t.Members[i].Friend && s.ChatHub.IsOnline(t.Members[i].ID)
				ids = append(ids, t.Members[i].ID)
			}
		}
		t.Conversation.Online = t.Conversation.Kind == "dm" && len(t.Members) == 2 && s.ChatHub.IsOnline(t.Conversation.OtherID)
		if n := len(t.Messages); n > 0 && before <= 0 {
			s.ChatHub.Send(ids, chat.Event{Type: "read", ConversationID: t.Conversation.ID, AccountID: a.ID, Upto: t.Messages[n-1].ID})
		}
		writeJSON(w, http.StatusOK, t)
	}))
	mux.HandleFunc("POST /v1/me/chat/{id}/messages", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b chat.New
		if !decode(w, r, &b) {
			return
		}
		m, ids, err := s.Chat.Send(r.Context(), a.ID, r.PathValue("id"), b)
		if err != nil {
			fail(w, err)
			return
		}
		s.ChatHub.Send(ids, chat.Event{Type: "msg", ConversationID: m.ConversationID, Message: &m})
		go s.noteOffline(m, others(ids, a.ID))
		writeJSON(w, http.StatusCreated, m)
	}))
	mux.HandleFunc("POST /v1/me/chat/{id}/read", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct{ Upto int64 }
		if !decode(w, r, &b) {
			return
		}
		ids, err := s.Chat.MarkRead(r.Context(), a.ID, r.PathValue("id"), b.Upto)
		if err != nil {
			fail(w, err)
			return
		}
		s.ChatHub.Send(others(ids, a.ID), chat.Event{Type: "read", ConversationID: r.PathValue("id"), AccountID: a.ID, Upto: b.Upto})
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("PUT /v1/me/chat/{id}/translate", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct{ On bool }
		if !decode(w, r, &b) {
			return
		}
		if err := s.Chat.SetTranslate(r.Context(), a.ID, r.PathValue("id"), b.On); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	// The web app asks before it stores a file for a chat, and before it hands one out.
	mux.HandleFunc("GET /v1/me/chat/{id}/can-upload", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		if err := s.Chat.CanUpload(r.Context(), a.ID, r.PathValue("id")); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("GET /v1/me/chat-media", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		ok, err := s.Chat.CanSeeMedia(r.Context(), a.ID, r.URL.Query().Get("key"))
		if err != nil {
			fail(w, err)
			return
		}
		if !ok {
			fail(w, chat.ErrNotMember)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("GET /v1/me/chat-messages/{msg}/translation", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		id, _ := strconv.ParseInt(r.PathValue("msg"), 10, 64)
		lang := r.URL.Query().Get("lang")
		if !langOK(lang) {
			fail(w, chat.ErrBadInput)
			return
		}
		src, body, err := s.Chat.Translation(r.Context(), a.ID, id, lang)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"source": src, "body": body})
	}))
	mux.HandleFunc("PUT /v1/me/chat-messages/{msg}/translation", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		id, _ := strconv.ParseInt(r.PathValue("msg"), 10, 64)
		var b struct{ Lang, Body string }
		if !decode(w, r, &b) {
			return
		}
		if !langOK(b.Lang) || b.Body == "" {
			fail(w, chat.ErrBadInput)
			return
		}
		if _, _, err := s.Chat.Translation(r.Context(), a.ID, id, b.Lang); err != nil {
			fail(w, err)
			return
		}
		if err := s.Chat.SaveTranslation(r.Context(), id, b.Lang, b.Body); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("POST /v1/me/chat-messages/{msg}/report", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		id, _ := strconv.ParseInt(r.PathValue("msg"), 10, 64)
		var b struct{ Reason string }
		if !decode(w, r, &b) {
			return
		}
		if err := s.Chat.Report(r.Context(), a.ID, id, b.Reason); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
}

func langOK(l string) bool {
	if len(l) < 2 || len(l) > 8 {
		return false
	}
	for _, c := range l {
		if !(c >= 'a' && c <= 'z') && !(c >= 'A' && c <= 'Z') && c != '-' {
			return false
		}
	}
	return true
}

// noteOffline adds a notification for members who are not on the site right now.
func (s *Server) noteOffline(m chat.Message, to []string) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for _, id := range to {
		if s.ChatHub.IsOnline(id) {
			continue
		}
		title, dedupe, err := s.Chat.OfflineNote(ctx, m, id)
		if err != nil {
			continue
		}
		_ = s.Notify.Add(ctx, id, notify.New{Kind: "reply", Title: title, Body: chat.Preview(m), Link: "/messages?c=" + m.ConversationID, Dedupe: dedupe})
	}
}
