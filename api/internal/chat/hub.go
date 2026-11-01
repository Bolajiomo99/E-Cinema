package chat

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// Event is what the server pushes to a viewer's open Messages page.
type Event struct {
	Type           string   `json:"type"` // msg | read | presence | typing | request | hello
	ConversationID string   `json:"conversationId,omitempty"`
	Message        *Message `json:"message,omitempty"`
	AccountID      string   `json:"accountId,omitempty"`
	Upto           int64    `json:"upto,omitempty"`
	Online         []string `json:"online,omitempty"` // hello: friends online now
	On             bool     `json:"on,omitempty"`
	// call: a voice or video call signal (ring, accept, decline, end, offer, answer, ice)
	// relayed as is between the two people in a direct chat.
	Call json.RawMessage `json:"call,omitempty"`
}

type client struct {
	accountID string
	out       chan Event
}

// Hub delivers chat events to every tab a viewer has open. One process holds all
// connections; with more API instances this would need a shared bus.
type Hub struct {
	mu     sync.Mutex
	byAcct map[string]map[*client]struct{}
}

func NewHub() *Hub { return &Hub{byAcct: map[string]map[*client]struct{}{}} }

func (h *Hub) add(c *client) (first bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	set := h.byAcct[c.accountID]
	if set == nil {
		set = map[*client]struct{}{}
		h.byAcct[c.accountID] = set
	}
	set[c] = struct{}{}
	return len(set) == 1
}

func (h *Hub) remove(c *client) (last bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	set := h.byAcct[c.accountID]
	delete(set, c)
	if len(set) == 0 {
		delete(h.byAcct, c.accountID)
		return true
	}
	return false
}

// Online reports which of ids have the site open now.
func (h *Hub) Online(ids []string) []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := []string{}
	for _, id := range ids {
		if len(h.byAcct[id]) > 0 {
			out = append(out, id)
		}
	}
	return out
}

// IsOnline is Online for one viewer.
func (h *Hub) IsOnline(id string) bool { return len(h.Online([]string{id})) == 1 }

// Send pushes e to every connection of each account in to. Slow tabs drop events and
// catch up from the API on their next fetch.
func (h *Hub) Send(to []string, e Event) {
	if h == nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, id := range to {
		for c := range h.byAcct[id] {
			select {
			case c.out <- e:
			default:
			}
		}
	}
}

// Live serves the websocket. check turns the pass in ?t= into an account id.
func (h *Hub) Live(store Store, check func(token string) (string, error), origins []string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		me, err := check(r.URL.Query().Get("t"))
		if err != nil {
			http.Error(w, "bad pass", http.StatusUnauthorized)
			return
		}
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: origins})
		if err != nil {
			return
		}
		defer conn.CloseNow()
		conn.SetReadLimit(64 << 10) // call offers carry SDP
		ctx, cancel := context.WithCancel(r.Context())
		defer cancel()

		friends, err := store.FriendIDs(ctx, me)
		if err != nil {
			slog.Error("chat friends failed", "err", err)
		}
		c := &client{accountID: me, out: make(chan Event, 64)}
		if h.add(c) {
			h.Send(friends, Event{Type: "presence", AccountID: me, On: true})
		}
		defer func() {
			if h.remove(c) {
				// Look friends up again: someone may have been added while connected.
				f, err := store.FriendIDs(context.Background(), me)
				if err != nil {
					f = friends
				}
				h.Send(f, Event{Type: "presence", AccountID: me, On: false})
			}
		}()
		c.out <- Event{Type: "hello", Online: h.Online(friends)}

		go func() {
			defer cancel()
			ping := time.NewTicker(25 * time.Second)
			defer ping.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case e := <-c.out:
					data, _ := json.Marshal(e)
					wctx, done := context.WithTimeout(ctx, 5*time.Second)
					err := conn.Write(wctx, websocket.MessageText, data)
					done()
					if err != nil {
						return
					}
				case <-ping.C:
					if err := conn.Ping(ctx); err != nil {
						return
					}
				}
			}
		}()

		// A client says two things over the socket: "I am typing" (at most every 2s) and call
		// signals for a direct chat (at most 120 every 10s, enough for ICE candidates).
		var lastTyping, window time.Time
		signals := 0
		for {
			_, data, err := conn.Read(ctx)
			if err != nil {
				return
			}
			var in struct {
				Type           string          `json:"type"`
				ConversationID string          `json:"conversationId"`
				Call           json.RawMessage `json:"call"`
			}
			if json.Unmarshal(data, &in) != nil {
				continue
			}
			switch in.Type {
			case "typing":
				if time.Since(lastTyping) < 2*time.Second {
					continue
				}
				lastTyping = time.Now()
			case "call":
				if time.Since(window) > 10*time.Second {
					window, signals = time.Now(), 0
				}
				if signals++; signals > 120 || !validSignal(in.Call) {
					continue
				}
			default:
				continue
			}
			others, err := h.others(ctx, store, me, in.ConversationID, in.Type == "call")
			if err != nil || len(others) == 0 {
				if in.Type == "call" {
					c.out <- Event{Type: "call", ConversationID: in.ConversationID, Call: json.RawMessage(`{"kind":"unavailable"}`)}
				}
				continue
			}
			if in.Type == "typing" {
				h.Send(others, Event{Type: "typing", ConversationID: in.ConversationID, AccountID: me})
			} else {
				h.Send(others, Event{Type: "call", ConversationID: in.ConversationID, AccountID: me, Call: in.Call})
			}
		}
	}
}

// others is everyone else in a conversation me belongs to. For calls it must be a direct
// chat whose other person has the site open; group calls are not offered.
func (h *Hub) others(ctx context.Context, store Store, me, conv string, call bool) ([]string, error) {
	if call {
		peer, err := store.CallPeer(ctx, me, conv)
		if err != nil || !h.IsOnline(peer) {
			return nil, err
		}
		return []string{peer}, nil
	}
	ids, err := store.Members(ctx, me, conv)
	if err != nil {
		return nil, err
	}
	out := []string{}
	for _, id := range ids {
		if id != me {
			out = append(out, id)
		}
	}
	return out, nil
}

var signalKinds = map[string]bool{"ring": true, "accept": true, "decline": true, "busy": true, "end": true, "offer": true, "answer": true, "ice": true}

// validSignal checks a call signal has a known kind and, for ring, a known media type.
func validSignal(raw json.RawMessage) bool {
	var s struct {
		Kind  string `json:"kind"`
		Video *bool  `json:"video"`
	}
	if len(raw) == 0 || json.Unmarshal(raw, &s) != nil || !signalKinds[s.Kind] {
		return false
	}
	return s.Kind != "ring" || s.Video != nil
}
