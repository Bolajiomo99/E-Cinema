package rooms

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// Event is everything the server pushes to a room.
type Event struct {
	Type    string   `json:"type"` // msg | react | presence | error
	Message *Message `json:"message,omitempty"`
	Emoji   string   `json:"emoji,omitempty"`
	Count   int      `json:"count,omitempty"`
	Error   string   `json:"error,omitempty"`
}

type client struct {
	accountID string
	country   string
	out       chan Event
}

// Hub fans events out to everyone connected to a screening.
type Hub struct {
	mu    sync.Mutex
	rooms map[string]map[*client]struct{}
	chat  map[string][]chatTick // recent messages per room, for the chat heat map
}

type chatTick struct {
	at      time.Time
	country string
}

// ChatWindow is how far back the chat heat looks.
const ChatWindow = 10 * time.Minute

func NewHub() *Hub {
	return &Hub{rooms: map[string]map[*client]struct{}{}, chat: map[string][]chatTick{}}
}

// noteChat records that someone from country sent a message in room.
func (h *Hub) noteChat(room, country string, now time.Time) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.chat[room] = append(pruneTicks(h.chat[room], now), chatTick{at: now, country: country})
}

func pruneTicks(ts []chatTick, now time.Time) []chatTick {
	i := 0
	for i < len(ts) && now.Sub(ts[i].at) > ChatWindow {
		i++
	}
	return ts[i:]
}

func (h *Hub) join(room string, c *client) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.rooms[room] == nil {
		h.rooms[room] = map[*client]struct{}{}
	}
	h.rooms[room][c] = struct{}{}
	return len(h.rooms[room])
}

func (h *Hub) leave(room string, c *client) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.rooms[room], c)
	n := len(h.rooms[room])
	if n == 0 {
		delete(h.rooms, room)
	}
	return n
}

// Count is how many connections a screening has right now.
func (h *Hub) Count(room string) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.rooms[room])
}

// Stat is a live room's audience: connected viewers and how many countries they come from.
type Stat struct {
	ShowtimeID string `json:"showtimeId"`
	Watching   int    `json:"watching"`
	Countries  int    `json:"countries"`
	// ByCountry counts distinct viewers per ISO country code. Country level only, never a city.
	ByCountry map[string]int `json:"byCountry"`
	// ChatByCountry counts messages per country over the last ChatWindow.
	ChatByCountry map[string]int `json:"chatByCountry"`
}

// Stats lists every room with someone in it. Two tabs from one account count once.
func (h *Hub) Stats() []Stat { return h.statsAt(time.Now()) }

func (h *Hub) statsAt(now time.Time) []Stat {
	h.mu.Lock()
	defer h.mu.Unlock()
	for room, ts := range h.chat {
		if ts = pruneTicks(ts, now); len(ts) == 0 || h.rooms[room] == nil {
			delete(h.chat, room)
		} else {
			h.chat[room] = ts
		}
	}
	out := make([]Stat, 0, len(h.rooms))
	for room, cs := range h.rooms {
		people := map[string]bool{}
		seen := map[string]map[string]bool{}
		for c := range cs {
			people[c.accountID] = true
			if c.country != "" {
				if seen[c.country] == nil {
					seen[c.country] = map[string]bool{}
				}
				seen[c.country][c.accountID] = true
			}
		}
		by := make(map[string]int, len(seen))
		for cc, who := range seen {
			by[cc] = len(who)
		}
		chat := map[string]int{}
		for _, t := range h.chat[room] {
			if t.country != "" {
				chat[t.country]++
			}
		}
		out = append(out, Stat{ShowtimeID: room, Watching: len(people), Countries: len(by), ByCountry: by, ChatByCountry: chat})
	}
	return out
}

// broadcast never blocks: a viewer too slow to keep up misses events instead of stalling the room.
func (h *Hub) broadcast(room string, e Event, mine *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.rooms[room] {
		ev := e
		if e.Message != nil {
			m := *e.Message
			m.Mine = mine != nil && c.accountID == mine.accountID
			ev.Message = &m
		}
		select {
		case c.out <- ev:
		default:
		}
	}
}

type incoming struct {
	Type  string `json:"type"` // msg | react
	Body  string `json:"body"`
	Emoji string `json:"emoji"`
}

// Live serves the room WebSocket. The pass in ?t= was issued only to a ticket holder.
func (h *Hub) Live(store Store, passes Passes, origins []string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		room := r.PathValue("id")
		pass, err := passes.Check(r.URL.Query().Get("t"), room, time.Now())
		if err != nil {
			http.Error(w, err.Error(), http.StatusUnauthorized)
			return
		}
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: origins})
		if err != nil {
			return
		}
		defer conn.CloseNow()
		conn.SetReadLimit(4096)
		ctx, cancel := context.WithCancel(r.Context())
		defer cancel()

		c := &client{accountID: pass.AccountID, country: pass.Country, out: make(chan Event, 64)}
		h.broadcast(room, Event{Type: "presence", Count: h.join(room, c)}, nil)
		defer func() { h.broadcast(room, Event{Type: "presence", Count: h.leave(room, c)}, nil) }()

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

		// Reactions are capped per connection so one person cannot flood everyone's screen.
		var lastReact time.Time
		for {
			_, data, err := conn.Read(ctx)
			if err != nil {
				return
			}
			var in incoming
			if json.Unmarshal(data, &in) != nil {
				continue
			}
			switch in.Type {
			case "msg":
				m, err := store.Post(ctx, room, pass.AccountID, pass.Name, in.Body)
				if err != nil {
					if !errors.Is(err, ErrTooFast) && !errors.Is(err, ErrEmpty) {
						slog.Error("room message failed", "err", err)
						err = errors.New("message not sent, try again")
					}
					select {
					case c.out <- Event{Type: "error", Error: err.Error()}:
					default:
					}
					continue
				}
				h.noteChat(room, c.country, time.Now())
				h.broadcast(room, Event{Type: "msg", Message: &m}, c)
			case "react":
				if Reactions[in.Emoji] && time.Since(lastReact) > 400*time.Millisecond {
					lastReact = time.Now()
					h.broadcast(room, Event{Type: "react", Emoji: in.Emoji}, nil)
				}
			}
		}
	}
}
