package chat_test

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/Bolajiomo99/E-Cinema/api/internal/chat"
	"github.com/Bolajiomo99/E-Cinema/api/internal/db"
)

func TestChat(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	p, err := db.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	if err := db.Migrate(ctx, p); err != nil {
		t.Fatal(err)
	}
	s := chat.Store{DB: p}
	p.Exec(ctx, `DELETE FROM conversations WHERE created_by IN (SELECT id FROM accounts WHERE email LIKE 'chat-%@example.com')`)
	p.Exec(ctx, `DELETE FROM accounts WHERE email LIKE 'chat-%@example.com'`)
	p.Exec(ctx, `DELETE FROM holds WHERE showtime_id = 'chat-room'`)
	id := func(email, name, country string) string {
		var x string
		if err := p.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash, country, app_language) VALUES ($1, $2, 'x', $3, 'en') RETURNING id`, email, name, country).Scan(&x); err != nil {
			t.Fatal(err)
		}
		return x
	}
	ada, kwame, lea, eve := id("chat-ada@example.com", "Ada Obi", "NG"), id("chat-kwame@example.com", "Kwame Mensah", "GH"), id("chat-lea@example.com", "Léa Martin", "FR"), id("chat-eve@example.com", "Eve Spam", "US")

	// Ada and Kwame shared a premiere, so Ada can find him by name; Eve is a stranger.
	p.Exec(ctx, `INSERT INTO showtimes VALUES ('chat-room', 'Red Earth', 'S', now() - interval '2 days', 90, 10, 500, 'USD') ON CONFLICT (id) DO NOTHING`)
	for _, a := range []string{ada, kwame} {
		p.Exec(ctx, `INSERT INTO holds (showtime_id, seats, viewer_ref, status, expires_at, account_id) VALUES ('chat-room', 1, 'r', 'paid', now(), $1)`, a)
	}
	if got, _ := s.Search(ctx, ada, "kwa"); len(got) != 1 || got[0].ID != kwame || got[0].Country != "GH" {
		t.Fatalf("search kwame = %+v", got)
	}
	if got, _ := s.Search(ctx, ada, "Eve"); len(got) != 0 {
		t.Fatalf("stranger listed by name: %+v", got)
	}
	if got, _ := s.Search(ctx, ada, "chat-eve@example.com"); len(got) != 1 {
		t.Fatalf("exact email search = %+v", got)
	}

	// Requests: Kwame asks Ada; Ada sees the shared room; accept makes friends.
	if f, err := s.SendRequest(ctx, kwame, ada, "Loved the room!", ""); err != nil || f {
		t.Fatalf("request: %v %v", f, err)
	}
	if _, err := s.SendRequest(ctx, kwame, ada, "", ""); !errors.Is(err, chat.ErrPending) {
		t.Fatalf("second request: %v", err)
	}
	s.SendRequest(ctx, eve, ada, "win money http://x", "rules")
	reqs, err := s.Requests(ctx, ada)
	if err != nil || len(reqs) != 2 || reqs[0].From.ID != kwame || reqs[0].Room != "Red Earth" || reqs[1].Spam != "rules" {
		t.Fatalf("requests = %+v, %v", reqs, err)
	}
	if _, err := s.Decide(ctx, ada, reqs[0].ID, "accept", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Decide(ctx, ada, reqs[1].ID, "report", "spam"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SendRequest(ctx, eve, ada, "", ""); !errors.Is(err, chat.ErrBlocked) {
		t.Fatalf("blocked request: %v", err)
	}
	// Léa asks, Ada asks back: that accepts.
	s.SendRequest(ctx, lea, ada, "", "")
	if f, err := s.SendRequest(ctx, ada, lea, "", ""); err != nil || !f {
		t.Fatalf("mutual request: %v %v", f, err)
	}
	if fr, _ := s.Friends(ctx, ada); len(fr) != 2 {
		t.Fatalf("friends = %+v", fr)
	}

	// DMs and messages.
	if _, err := s.OpenDM(ctx, ada, eve); !errors.Is(err, chat.ErrNotFriends) {
		t.Fatalf("dm stranger: %v", err)
	}
	dm, err := s.OpenDM(ctx, ada, kwame)
	if err != nil {
		t.Fatal(err)
	}
	if again, _ := s.OpenDM(ctx, kwame, ada); again != dm {
		t.Fatal("dm not shared")
	}
	m, ids, err := s.Send(ctx, kwame, dm, chat.New{Kind: "text", Body: "That captain is my uncle!"})
	if err != nil || len(ids) != 2 || m.SenderName != "Kwame Mensah" {
		t.Fatalf("send: %+v %v %v", m, ids, err)
	}
	if _, _, err := s.Send(ctx, eve, dm, chat.New{Kind: "text", Body: "hi"}); !errors.Is(err, chat.ErrNotMember) {
		t.Fatalf("outsider send: %v", err)
	}
	if _, _, err := s.Send(ctx, ada, dm, chat.New{Kind: "voice", MediaKey: "chat/00000000-0000-0000-0000-000000000000/11111111-1111-1111-1111-111111111111.webm", DurationMs: 9000}); !errors.Is(err, chat.ErrBadInput) {
		t.Fatalf("media from another chat: %v", err)
	}
	key := "chat/" + dm + "/11111111-1111-1111-1111-111111111111.webm"
	v, _, err := s.Send(ctx, ada, dm, chat.New{Kind: "voice", MediaKey: key, DurationMs: 9000, Transcript: "Which part of Accra?"})
	if err != nil {
		t.Fatal(err)
	}
	if ok, _ := s.CanSeeMedia(ctx, kwame, key); !ok {
		t.Fatal("member cannot see media")
	}
	if ok, _ := s.CanSeeMedia(ctx, eve, key); ok {
		t.Fatal("outsider can see media")
	}
	if n, _ := s.Unread(ctx, kwame); n != 1 {
		t.Fatalf("kwame unread = %d", n)
	}
	list, err := s.List(ctx, kwame, "")
	if err != nil || len(list) != 1 || list[0].Name != "Ada Obi" || list[0].Unread != 1 || list[0].Last.ID != v.ID {
		t.Fatalf("list = %+v %v", list, err)
	}
	th, err := s.Open(ctx, kwame, dm, 0)
	if err != nil || len(th.Messages) != 2 || th.Messages[0].ID != m.ID || th.Conversation.Name != "Ada Obi" || th.ReadBy[ada] != v.ID {
		t.Fatalf("open = %+v %v", th, err)
	}
	if n, _ := s.Unread(ctx, kwame); n != 0 {
		t.Fatalf("unread after open = %d", n)
	}

	// Groups: only friends can be added; a group shows up in the groups filter.
	if _, err := s.CreateGroup(ctx, ada, "Film club", []string{kwame, eve}); !errors.Is(err, chat.ErrNotFriends) {
		t.Fatalf("group with stranger: %v", err)
	}
	g, err := s.CreateGroup(ctx, ada, "Film club", []string{kwame, lea})
	if err != nil {
		t.Fatal(err)
	}
	if groups, _ := s.List(ctx, lea, "groups"); len(groups) != 1 || groups[0].ID != g || groups[0].Members != 3 {
		t.Fatalf("groups = %+v", groups)
	}
	if err := s.Report(ctx, ada, m.ID, "spam"); err != nil {
		t.Fatal(err)
	}
	if err := s.Leave(ctx, lea, g); err != nil {
		t.Fatal(err)
	}
	// Unfriending stops new messages in the dm.
	s.Unfriend(ctx, ada, kwame)
	if _, _, err := s.Send(ctx, ada, dm, chat.New{Kind: "text", Body: "still there?"}); !errors.Is(err, chat.ErrNotFriends) {
		t.Fatalf("send after unfriend: %v", err)
	}
}
