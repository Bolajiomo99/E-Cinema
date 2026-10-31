package rooms

import (
	"testing"
	"time"
)

func TestHubStatsCountsPeopleAndCountries(t *testing.T) {
	h := NewHub()
	a1 := &client{accountID: "a1", country: "NG"}
	a1tab := &client{accountID: "a1", country: "NG"}
	b := &client{accountID: "b", country: "IN"}
	c := &client{accountID: "c"}
	for _, cl := range []*client{a1, a1tab, b, c} {
		h.join("s1", cl)
	}
	h.join("s2", &client{accountID: "d", country: "FR"})
	got := map[string]Stat{}
	for _, s := range h.Stats() {
		got[s.ShowtimeID] = s
	}
	if s := got["s1"]; s.Watching != 3 || s.Countries != 2 {
		t.Fatalf("s1 = %+v, want 3 people from 2 countries", s)
	}
	if by := got["s1"].ByCountry; by["NG"] != 1 || by["IN"] != 1 || len(by) != 2 {
		t.Fatalf("s1 byCountry = %v, want NG:1 IN:1 (two tabs count once)", by)
	}
	if s := got["s2"]; s.Watching != 1 || s.Countries != 1 {
		t.Fatalf("s2 = %+v", s)
	}
	h.leave("s2", got2(h, "s2"))
	if len(h.Stats()) != 1 {
		t.Fatal("an empty room must drop out of the stats")
	}
}

func got2(h *Hub, room string) *client {
	for c := range h.rooms[room] {
		return c
	}
	return nil
}

func TestHubChatHeatForgetsOldMessages(t *testing.T) {
	h := NewHub()
	h.join("s1", &client{accountID: "a", country: "NG"})
	now := time.Now()
	h.noteChat("s1", "NG", now.Add(-ChatWindow-time.Minute))
	h.noteChat("s1", "NG", now.Add(-time.Minute))
	h.noteChat("s1", "KE", now)
	st := h.statsAt(now)
	if len(st) != 1 || st[0].ChatByCountry["NG"] != 1 || st[0].ChatByCountry["KE"] != 1 {
		t.Fatalf("chat heat = %+v, want NG:1 KE:1", st)
	}
}
