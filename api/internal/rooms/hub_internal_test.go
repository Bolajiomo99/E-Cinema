package rooms

import "testing"

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
