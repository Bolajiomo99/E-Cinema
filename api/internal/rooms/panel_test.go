package rooms_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/rooms"
)

func TestPassCarriesLangAndParty(t *testing.T) {
	p := rooms.Passes{Key: []byte("k")}
	now := time.Now()
	got, err := p.Check(p.Issue(rooms.Pass{AccountID: "a", ShowtimeID: "s", Name: "N", Expires: now.Add(time.Minute), Lang: "yo", PartyID: "p1"}), "s", now)
	if err != nil || got.Lang != "yo" || got.PartyID != "p1" || got.Country != "" {
		t.Fatalf("pass = %+v, %v", got, err)
	}
}

func TestRoomPanel(t *testing.T) {
	p := pool(t)
	ctx := context.Background()
	st := rooms.Store{DB: p}
	clean := func() {
		p.Exec(ctx, `DELETE FROM room_polls WHERE showtime_id = 'panel-test'`)
		p.Exec(ctx, `DELETE FROM talk_time WHERE showtime_id = 'panel-test'`)
		p.Exec(ctx, `DELETE FROM room_messages WHERE showtime_id = 'panel-test'`)
		p.Exec(ctx, `DELETE FROM parties WHERE showtime_id = 'panel-test'`)
	}
	clean()
	t.Cleanup(clean)
	if _, err := p.Exec(ctx, `INSERT INTO showtimes VALUES ('panel-test', 'F', 'S', now() + interval '1 hour', 90, 10, 500, 'USD') ON CONFLICT (id) DO NOTHING`); err != nil {
		t.Fatal(err)
	}
	host, guest, stranger := account(t, p, "panel-host@example.com"), account(t, p, "panel-guest@example.com"), account(t, p, "panel-x@example.com")
	var party string
	if err := p.QueryRow(ctx, `INSERT INTO parties (code, showtime_id, host_id, name, visibility) VALUES ('panel-test-room', 'panel-test', $1, 'Tolu''s party', 'link') RETURNING id`, host).Scan(&party); err != nil {
		t.Fatal(err)
	}
	p.Exec(ctx, `INSERT INTO party_members (party_id, account_id) VALUES ($1, $2), ($1, $3)`, party, host, guest)

	got, err := st.PartyFor(ctx, "panel-test", guest)
	if err != nil || got == nil || got.ID != party || len(got.Members) != 2 || !got.Members[0].Host {
		t.Fatalf("party = %+v, %v", got, err)
	}
	if none, _ := st.PartyFor(ctx, "panel-test", stranger); none != nil {
		t.Fatal("stranger has a party")
	}

	// Room messages stay in the party; world messages go to everyone.
	if _, err := st.PostWith(ctx, "panel-test", host, "Tolu", "party only", rooms.Extra{PartyID: party, Lang: "yo"}); err != nil {
		t.Fatal(err)
	}
	time.Sleep(1100 * time.Millisecond)
	w, err := st.PostWith(ctx, "panel-test", host, "Tolu", "E ku ojo", rooms.Extra{Lang: "yo", Country: "NG"})
	if err != nil || w.Scope != "world" {
		t.Fatalf("world post = %+v, %v", w, err)
	}
	world, _ := st.Recent(ctx, "panel-test", stranger, 50)
	room, _ := st.RecentParty(ctx, "panel-test", guest, party, 50)
	if len(world) != 1 || world[0].Lang != "yo" || world[0].Country != "NG" || len(room) != 1 || room[0].Scope != "room" {
		t.Fatalf("world = %+v room = %+v", world, room)
	}
	if _, err := st.PostWith(ctx, "panel-test", guest, "G", "Voice note", rooms.Extra{Kind: "voice", Media: json.RawMessage(`{"key":"k","seconds":4}`)}); err != nil {
		t.Fatal(err)
	}

	// Translations are stored once per language, with the spoiler verdict.
	done, missing, err := st.Translations(ctx, "panel-test", "en", []int64{w.ID, 999999999})
	if err != nil || len(done) != 0 || len(missing) != 1 || missing[0].Body != "E ku ojo" {
		t.Fatalf("translations = %v %+v %v", done, missing, err)
	}
	if err := st.SaveTranslations(ctx, "panel-test", "en", []rooms.Translated{{ID: w.ID, Body: "Good day", Spoiler: true}}); err != nil {
		t.Fatal(err)
	}
	done, missing, _ = st.Translations(ctx, "panel-test", "en", []int64{w.ID})
	world, _ = st.Recent(ctx, "panel-test", stranger, 50)
	if done[w.ID] != "Good day" || len(missing) != 0 || !world[0].Spoiler {
		t.Fatalf("after save = %v %+v %+v", done, missing, world[0])
	}

	// Polls: the world poll appears on its own; room polls only for the party.
	polls, err := st.Polls(ctx, "panel-test", "", stranger)
	if err != nil || len(polls) != 1 || polls[0].Scope != "world" || polls[0].Question != rooms.WorldQuestion.Q {
		t.Fatalf("polls = %+v, %v", polls, err)
	}
	if _, err := st.CreatePoll(ctx, "panel-test", "", stranger, "Who?", []string{"A", "B"}); !errors.Is(err, rooms.ErrNoParty) {
		t.Fatalf("poll without party: %v", err)
	}
	if _, err := st.CreatePoll(ctx, "panel-test", party, host, "Who?", []string{"A"}); !errors.Is(err, rooms.ErrBadPoll) {
		t.Fatalf("one-answer poll: %v", err)
	}
	rp, err := st.CreatePoll(ctx, "panel-test", party, host, "Who took the ledger?", []string{"Ifeoma", "The banker", " "})
	if err != nil || len(rp.Options) != 2 {
		t.Fatalf("room poll = %+v, %v", rp, err)
	}
	if _, err := st.Vote(ctx, "panel-test", "", stranger, "en", rp.ID, 0); !errors.Is(err, rooms.ErrNoPoll) {
		t.Fatalf("outsider voting in a party poll: %v", err)
	}
	if _, err := st.Vote(ctx, "panel-test", party, guest, "ig", rp.ID, 5); !errors.Is(err, rooms.ErrNoPoll) {
		t.Fatalf("bad choice: %v", err)
	}
	st.Vote(ctx, "panel-test", party, guest, "ig", rp.ID, 1)
	v, err := st.Vote(ctx, "panel-test", party, guest, "ig", rp.ID, 0) // changing one's mind
	if err != nil || v.Votes != 1 || v.Options[0].Votes != 1 || v.Mine == nil || *v.Mine != 0 {
		t.Fatalf("vote = %+v, %v", v, err)
	}
	st.Vote(ctx, "panel-test", "", stranger, "fr", polls[0].ID, 0)
	wv, _ := st.Vote(ctx, "panel-test", "", host, "yo", polls[0].ID, 2)
	if wv.Votes != 2 || wv.Languages != 2 {
		t.Fatalf("world poll = %+v", wv)
	}
	if mine, _ := st.Polls(ctx, "panel-test", party, guest); len(mine) != 2 || mine[0].Scope != "room" {
		t.Fatalf("party polls = %+v", mine)
	}

	// Talk time: free members get five minutes per premiere, paying members are not counted down.
	if left, _ := st.TalkLeft(ctx, "panel-test", guest, "free"); left != rooms.FreeTalkSeconds {
		t.Fatalf("talk left = %d", left)
	}
	if left, err := st.UseTalk(ctx, "panel-test", guest, "free", 200); err != nil || left != 100 {
		t.Fatalf("use talk = %d, %v", left, err)
	}
	if _, err := st.UseTalk(ctx, "panel-test", guest, "free", 101); !errors.Is(err, rooms.ErrTalkUsedUp) {
		t.Fatalf("over the allowance: %v", err)
	}
	if left, _ := st.UseTalk(ctx, "panel-test", guest, "free", 100); left != 0 {
		t.Fatalf("last seconds = %d", left)
	}
	if _, err := st.UseTalk(ctx, "panel-test", stranger, "free", 301); !errors.Is(err, rooms.ErrTalkUsedUp) {
		t.Fatalf("first note too long: %v", err)
	}
	if left, err := st.UseTalk(ctx, "panel-test", host, "pro", 900); err != nil || left != -1 {
		t.Fatalf("pro talk = %d, %v", left, err)
	}
}
