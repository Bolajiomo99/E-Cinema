package rooms

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// Event is everything the server pushes to a room.
type Event struct {
	Type    string   `json:"type"` // msg | react | presence | poll | friends | error
	Message *Message `json:"message,omitempty"`
	Poll    *Poll    `json:"poll,omitempty"`
	Online  []string `json:"online,omitempty"` // display names of party members connected now
	IDs     []int64  `json:"ids,omitempty"`    // hide | blocked: messages to take off the screen
	Emoji   string   `json:"emoji,omitempty"`
	Count   int      `json:"count,omitempty"`
	Error   string   `json:"error,omitempty"`
}

type client struct {
	accountID string
	name      string
	country   string
	lang      string
	partyID   string
	blocked   map[string]bool // accounts this viewer blocked; guarded by Hub.mu
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

// OnlineIn lists the accounts of a party that are connected to the premiere right now.
func (h *Hub) OnlineIn(room, partyID string) map[string]bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := map[string]bool{}
	for c := range h.rooms[room] {
		if partyID != "" && c.partyID == partyID {
			out[c.accountID] = true
		}
	}
	return out
}

func (h *Hub) partyNames(room, partyID string) []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	seen := map[string]bool{}
	out := []string{}
	for c := range h.rooms[room] {
		if c.partyID == partyID && !seen[c.accountID] {
			seen[c.accountID] = true
			out = append(out, c.name)
		}
	}
	return out
}

// Publish sends a message stored elsewhere (a voice note or file posted over HTTP) to the room.
func (h *Hub) Publish(room string, m Message, fromAccount string) {
	h.broadcastParty(room, m.partyID, Event{Type: "msg", Message: &m}, &client{accountID: fromAccount})
}

// broadcast sends to everyone at the premiere.
func (h *Hub) broadcast(room string, e Event, mine *client) { h.broadcastParty(room, "", e, mine) }

// broadcastParty never blocks: a viewer too slow to keep up misses events instead of stalling the room.
// With a partyID, only that party's members get the event.
func (h *Hub) broadcastParty(room, partyID string, e Event, mine *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.rooms[room] {
		if partyID != "" && c.partyID != partyID {
			continue
		}
		if e.Message != nil && c.blocked[e.Message.author] {
			continue
		}
		ev := e
		if e.Message != nil {
			m := *e.Message
			m.Mine = mine != nil && c.accountID == mine.accountID
			ev.Message = &m
		}
		if e.Poll != nil {
			p := *e.Poll
			p.Mine = nil
			if mine != nil && c.accountID == mine.accountID {
				p.Mine = e.Poll.Mine
			}
			ev.Poll = &p
		}
		select {
		case c.out <- ev:
		default:
		}
	}
}

type incoming struct {
	Type     string   `json:"type"` // msg | react | vote | poll
	Body     string   `json:"body"`
	Emoji    string   `json:"emoji"`
	Scope    string   `json:"scope"` // msg: room | world
	Poll     int64    `json:"poll"`
	Choice   int      `json:"choice"`
	Question string   `json:"question"`
	Options  []string `json:"options"`
	Message  int64    `json:"message"` // report | block
	Reason   string   `json:"reason"`
	Block    bool     `json:"block"`
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

		blocked, err := store.Blocked(ctx, pass.AccountID)
		if err != nil {
			slog.Error("room blocks failed", "err", err)
			blocked = map[string]bool{}
		}
		c := &client{accountID: pass.AccountID, name: pass.Name, country: pass.Country, lang: pass.Lang, partyID: pass.PartyID, blocked: blocked, out: make(chan Event, 64)}
		h.broadcast(room, Event{Type: "presence", Count: h.join(room, c)}, nil)
		if c.partyID != "" {
			h.broadcastParty(room, c.partyID, Event{Type: "friends", Online: h.partyNames(room, c.partyID)}, nil)
		}
		defer func() {
			h.broadcast(room, Event{Type: "presence", Count: h.leave(room, c)}, nil)
			if c.partyID != "" {
				h.broadcastParty(room, c.partyID, Event{Type: "friends", Online: h.partyNames(room, c.partyID)}, nil)
			}
		}()
		say := func(err error) {
			select {
			case c.out <- Event{Type: "error", Error: strings.TrimPrefix(err.Error(), "invalid input: ")}:
			default:
			}
		}

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
				party := ""
				if in.Scope == "room" {
					if c.partyID == "" {
						say(ErrNoParty)
						continue
					}
					party = c.partyID
				}
				m, err := store.PostWith(ctx, room, pass.AccountID, pass.Name, in.Body, Extra{PartyID: party, Lang: c.lang, Country: c.country})
				if err != nil {
					if !errors.Is(err, ErrTooFast) && !errors.Is(err, ErrEmpty) {
						slog.Error("room message failed", "err", err)
						err = errors.New("message not sent, try again")
					}
					say(err)
					continue
				}
				h.noteChat(room, c.country, time.Now())
				h.broadcastParty(room, party, Event{Type: "msg", Message: &m}, c)
			case "vote":
				p, err := store.Vote(ctx, room, c.partyID, pass.AccountID, c.lang, in.Poll, in.Choice)
				if err != nil {
					if !errors.Is(err, ErrNoPoll) {
						slog.Error("room vote failed", "err", err)
						err = errors.New("vote not counted, try again")
					}
					say(err)
					continue
				}
				h.broadcastParty(room, p.partyID, Event{Type: "poll", Poll: &p}, c)
			case "report", "block":
				if in.Type == "report" {
					hidden, err := store.Report(ctx, room, pass.AccountID, in.Message, in.Reason)
					if err != nil {
						if !errors.Is(err, ErrBadReason) && !errors.Is(err, ErrNoMessage) && !errors.Is(err, ErrReportSelf) {
							slog.Error("room report failed", "err", err)
							err = errors.New("report not sent, try again")
						}
						say(err)
						continue
					}
					if hidden {
						h.broadcast(room, Event{Type: "hide", IDs: []int64{in.Message}}, nil)
					}
				}
				if in.Type == "block" || in.Block {
					author, ids, err := store.Block(ctx, room, pass.AccountID, in.Message)
					if err != nil {
						if !errors.Is(err, ErrNoMessage) && !errors.Is(err, ErrReportSelf) {
							slog.Error("room block failed", "err", err)
							err = errors.New("block not saved, try again")
						}
						say(err)
						continue
					}
					h.mu.Lock()
					c.blocked[author] = true
					h.mu.Unlock()
					select {
					case c.out <- Event{Type: "blocked", IDs: ids}:
					default:
					}
				}
				select {
				case c.out <- Event{Type: "reported"}:
				default:
				}
			case "poll":
				p, err := store.CreatePoll(ctx, room, c.partyID, pass.AccountID, in.Question, in.Options)
				if err != nil {
					if !errors.Is(err, ErrNoParty) && !errors.Is(err, ErrBadPoll) && !errors.Is(err, ErrTooFast) {
						slog.Error("room poll failed", "err", err)
						err = errors.New("poll not started, try again")
					}
					say(err)
					continue
				}
				h.broadcastParty(room, p.partyID, Event{Type: "poll", Poll: &p}, c)
			case "react":
				if Reactions[in.Emoji] && time.Since(lastReact) > 400*time.Millisecond {
					lastReact = time.Now()
					h.broadcast(room, Event{Type: "react", Emoji: in.Emoji}, nil)
				}
			}
		}
	}
}
