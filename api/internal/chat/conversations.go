package chat

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

var (
	uuidRe  = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	mediaRe = regexp.MustCompile(`^chat/[0-9a-f-]{36}/[0-9a-f-]{36}\.(webm|ogg|mp4|m4a|jpg|png|webp)$`)
	partyRe = regexp.MustCompile(`^[a-z0-9-]{6,40}$`)
)

// Conversation is one row in the chat list.
type Conversation struct {
	ID        string    `json:"id"`
	Kind      string    `json:"kind"` // dm | group
	Name      string    `json:"name"`
	OtherID   string    `json:"otherId,omitempty"` // dm only
	Members   int       `json:"members"`
	Last      *Message  `json:"last"`
	LastAt    time.Time `json:"lastAt"`
	Unread    int       `json:"unread"`
	Online    bool      `json:"online"`
	Role      string    `json:"role"`
	Translate bool      `json:"translate"`
}

type Message struct {
	ID             int64     `json:"id"`
	ConversationID string    `json:"conversationId"`
	SenderID       string    `json:"senderId"`
	SenderName     string    `json:"senderName"`
	Kind           string    `json:"kind"`
	Body           string    `json:"body"`
	MediaKey       string    `json:"mediaKey,omitempty"`
	DurationMs     int       `json:"durationMs,omitempty"`
	Transcript     string    `json:"transcript,omitempty"`
	Party          *Party    `json:"party,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
}

// Party is the card shown for a shared watch party.
type Party struct {
	Code     string    `json:"code"`
	Name     string    `json:"name"`
	Film     string    `json:"film"`
	Showtime string    `json:"showtimeId"`
	StartsAt time.Time `json:"startsAt"`
}

// New is what a sender supplies.
type New struct {
	Kind       string `json:"kind"`
	Body       string `json:"body"`
	MediaKey   string `json:"mediaKey"`
	DurationMs int    `json:"durationMs"`
	Transcript string `json:"transcript"`
	PartyCode  string `json:"partyCode"`
}

func member(ctx context.Context, tx pgx.Tx, conv, me string) (kind string, err error) {
	if !uuidRe.MatchString(conv) {
		return "", ErrNotFound
	}
	err = tx.QueryRow(ctx, `SELECT c.kind FROM conversations c JOIN conversation_members m ON m.conversation_id = c.id AND m.account_id = $2 WHERE c.id = $1`, conv, me).Scan(&kind)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotMember
	}
	return kind, err
}

// OpenDM returns the chat with a friend, making it on first use.
func (s Store) OpenDM(ctx context.Context, me, friend string) (string, error) {
	if me == friend {
		return "", ErrSelf
	}
	var id string
	err := pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		if f, err := areFriends(ctx, tx, me, friend); err != nil || !f {
			if err == nil {
				err = ErrNotFriends
			}
			return err
		}
		x, y := pair(me, friend)
		err := tx.QueryRow(ctx, `INSERT INTO conversations (kind, dm_key, created_by) VALUES ('dm', $1, $2)
		  ON CONFLICT (dm_key) DO UPDATE SET dm_key = EXCLUDED.dm_key RETURNING id::text`, x+":"+y, me).Scan(&id)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO conversation_members (conversation_id, account_id) VALUES ($1, $2), ($1, $3) ON CONFLICT DO NOTHING`, id, me, friend)
		return err
	})
	return id, err
}

// CreateGroup makes a group from my friends.
func (s Store) CreateGroup(ctx context.Context, me, name string, members []string) (string, error) {
	name = strings.TrimSpace(name)
	if l := len([]rune(name)); l < 1 || l > 40 || len(members) < 1 || len(members) >= MaxGroupMembers {
		return "", ErrBadInput
	}
	var id string
	err := pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		var n int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM conversations WHERE kind = 'group' AND created_by = $1`, me).Scan(&n); err != nil {
			return err
		}
		if n >= MaxGroups {
			return ErrTooMany
		}
		for _, m := range members {
			if !uuidRe.MatchString(m) {
				return ErrBadInput
			}
			if f, err := areFriends(ctx, tx, me, m); err != nil || !f {
				if err == nil {
					err = ErrNotFriends
				}
				return err
			}
		}
		if err := tx.QueryRow(ctx, `INSERT INTO conversations (kind, name, created_by) VALUES ('group', $1, $2) RETURNING id::text`, name, me).Scan(&id); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO conversation_members (conversation_id, account_id, role) VALUES ($1, $2, 'owner')`, id, me); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO conversation_members (conversation_id, account_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`, id, members)
		return err
	})
	return id, err
}

// AddToGroup lets any member add their own friends.
func (s Store) AddToGroup(ctx context.Context, me, conv string, members []string) error {
	return pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		kind, err := member(ctx, tx, conv, me)
		if err != nil {
			return err
		}
		if kind != "group" {
			return ErrBadInput
		}
		var n int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM conversation_members WHERE conversation_id = $1`, conv).Scan(&n); err != nil {
			return err
		}
		if n+len(members) > MaxGroupMembers {
			return ErrTooMany
		}
		for _, m := range members {
			if !uuidRe.MatchString(m) {
				return ErrBadInput
			}
			if f, err := areFriends(ctx, tx, me, m); err != nil || !f {
				if err == nil {
					err = ErrNotFriends
				}
				return err
			}
		}
		_, err = tx.Exec(ctx, `INSERT INTO conversation_members (conversation_id, account_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`, conv, members)
		return err
	})
}

// Leave takes me out of a group. The last one out removes it.
func (s Store) Leave(ctx context.Context, me, conv string) error {
	return pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		kind, err := member(ctx, tx, conv, me)
		if err != nil {
			return err
		}
		if kind != "group" {
			return ErrBadInput
		}
		if _, err := tx.Exec(ctx, `DELETE FROM conversation_members WHERE conversation_id = $1 AND account_id = $2`, conv, me); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `DELETE FROM conversations WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = $1)`, conv)
		return err
	})
}

const msgCols = `m.id, m.conversation_id::text, coalesce(m.sender_id::text, ''), coalesce(sa.name, ''), m.kind, m.body, coalesce(m.media_key, ''),
  coalesce(m.duration_ms, 0), coalesce(m.transcript, ''), coalesce(p.code, ''), coalesce(p.name, ''), coalesce(pst.film, ''), coalesce(pst.id, ''), coalesce(pst.starts_at, 'epoch'), m.created_at`

const msgJoins = ` LEFT JOIN accounts sa ON sa.id = m.sender_id LEFT JOIN parties p ON p.code = m.party_code LEFT JOIN showtimes pst ON pst.id = p.showtime_id`

func scanMsg(row pgx.Row) (Message, error) {
	var m Message
	var p Party
	err := row.Scan(&m.ID, &m.ConversationID, &m.SenderID, &m.SenderName, &m.Kind, &m.Body, &m.MediaKey, &m.DurationMs, &m.Transcript,
		&p.Code, &p.Name, &p.Film, &p.Showtime, &p.StartsAt, &m.CreatedAt)
	if p.Code != "" {
		m.Party = &p
	}
	return m, err
}

// List returns my chats, newest first. filter: "", friends (dms) or groups.
func (s Store) List(ctx context.Context, me, filter string) ([]Conversation, error) {
	kind := map[string]string{"": "", "all": "", "friends": "dm", "groups": "group"}
	k, ok := kind[filter]
	if !ok {
		return nil, ErrBadInput
	}
	rows, err := s.DB.Query(ctx, `
	  SELECT c.id::text, c.kind, CASE WHEN c.kind = 'dm' THEN coalesce(o.name, 'Former member') ELSE c.name END, coalesce(o.id::text, ''),
	    (SELECT count(*)::int FROM conversation_members x WHERE x.conversation_id = c.id), c.last_at, me.role, me.translate,
	    (SELECT count(*)::int FROM messages u WHERE u.conversation_id = c.id AND u.id > me.last_read AND u.sender_id IS DISTINCT FROM $1),
	    lm.id
	  FROM conversation_members me JOIN conversations c ON c.id = me.conversation_id
	  LEFT JOIN LATERAL (SELECT a.id, a.name FROM conversation_members om JOIN accounts a ON a.id = om.account_id
	    WHERE c.kind = 'dm' AND om.conversation_id = c.id AND om.account_id <> $1 LIMIT 1) o ON true
	  LEFT JOIN LATERAL (SELECT id FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) lm ON true
	  WHERE me.account_id = $1 AND ($2 = '' OR c.kind = $2)
	    AND (c.kind = 'group' OR lm.id IS NOT NULL OR c.created_by = $1)
	  ORDER BY c.last_at DESC LIMIT 200`, me, k)
	if err != nil {
		return nil, err
	}
	out := []Conversation{}
	var lastIDs []int64
	for rows.Next() {
		var c Conversation
		var last *int64
		if err := rows.Scan(&c.ID, &c.Kind, &c.Name, &c.OtherID, &c.Members, &c.LastAt, &c.Role, &c.Translate, &c.Unread, &last); err != nil {
			rows.Close()
			return nil, err
		}
		if last != nil {
			lastIDs = append(lastIDs, *last)
		}
		out = append(out, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(lastIDs) == 0 {
		return out, nil
	}
	mrows, err := s.DB.Query(ctx, `SELECT `+msgCols+` FROM messages m`+msgJoins+` WHERE m.id = ANY($1)`, lastIDs)
	if err != nil {
		return nil, err
	}
	defer mrows.Close()
	byConv := map[string]*Message{}
	for mrows.Next() {
		m, err := scanMsg(mrows)
		if err != nil {
			return nil, err
		}
		byConv[m.ConversationID] = &m
	}
	for i := range out {
		out[i].Last = byConv[out[i].ID]
	}
	return out, mrows.Err()
}

// Thread is one open chat: its messages and how far the others have read.
type Thread struct {
	Conversation Conversation     `json:"conversation"`
	Messages     []Message        `json:"messages"`
	ReadBy       map[string]int64 `json:"readBy"` // other members' last read message
	Members      []Person         `json:"members"`
	More         bool             `json:"more"`
}

// Open returns the newest messages (or those before `before`) and marks them read.
func (s Store) Open(ctx context.Context, me, conv string, before int64) (Thread, error) {
	var t Thread
	err := pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		if _, err := member(ctx, tx, conv, me); err != nil {
			return err
		}
		c := &t.Conversation
		if err := tx.QueryRow(ctx, `SELECT c.id::text, c.kind, c.name, c.last_at, m.role, m.translate FROM conversations c
		  JOIN conversation_members m ON m.conversation_id = c.id AND m.account_id = $2 WHERE c.id = $1`, conv, me).
			Scan(&c.ID, &c.Kind, &c.Name, &c.LastAt, &c.Role, &c.Translate); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `SELECT `+personCols+`, m.last_read,
		    EXISTS (SELECT 1 FROM friends f WHERE (f.a = $2 AND f.b = a.id) OR (f.b = $2 AND f.a = a.id))
		  FROM conversation_members m JOIN accounts a ON a.id = m.account_id WHERE m.conversation_id = $1 ORDER BY a.name`, conv, me)
		if err != nil {
			return err
		}
		t.ReadBy = map[string]int64{}
		for rows.Next() {
			var p Person
			var read int64
			if err := rows.Scan(&p.ID, &p.Name, &p.Country, &p.Languages, &read, &p.Friend); err != nil {
				rows.Close()
				return err
			}
			if p.ID != me {
				t.ReadBy[p.ID] = read
				if c.Kind == "dm" {
					c.Name, c.OtherID = p.Name, p.ID
				}
			}
			t.Members = append(t.Members, p)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		c.Members = len(t.Members)
		if before <= 0 {
			before = 1 << 62
		}
		mrows, err := tx.Query(ctx, `SELECT `+msgCols+` FROM messages m`+msgJoins+` WHERE m.conversation_id = $1 AND m.id < $2 ORDER BY m.id DESC LIMIT $3`, conv, before, PageSize+1)
		if err != nil {
			return err
		}
		for mrows.Next() {
			m, err := scanMsg(mrows)
			if err != nil {
				mrows.Close()
				return err
			}
			t.Messages = append(t.Messages, m)
		}
		mrows.Close()
		if err := mrows.Err(); err != nil {
			return err
		}
		if len(t.Messages) > PageSize {
			t.Messages, t.More = t.Messages[:PageSize], true
		}
		for i, j := 0, len(t.Messages)-1; i < j; i, j = i+1, j-1 {
			t.Messages[i], t.Messages[j] = t.Messages[j], t.Messages[i]
		}
		if t.Messages == nil {
			t.Messages = []Message{}
		}
		_, err = tx.Exec(ctx, `UPDATE conversation_members SET last_read = greatest(last_read, coalesce((SELECT max(id) FROM messages WHERE conversation_id = $1), 0))
		  WHERE conversation_id = $1 AND account_id = $2`, conv, me)
		return err
	})
	return t, err
}

// Send stores a message and returns it with the ids of everyone in the chat.
func (s Store) Send(ctx context.Context, me, conv string, n New) (Message, []string, error) {
	n.Body = strings.TrimSpace(n.Body)
	switch n.Kind {
	case "text":
		if n.Body == "" || len([]rune(n.Body)) > 2000 || n.MediaKey != "" || n.PartyCode != "" {
			return Message{}, nil, ErrBadInput
		}
	case "voice", "photo":
		if !mediaRe.MatchString(n.MediaKey) || !strings.HasPrefix(n.MediaKey, "chat/"+conv+"/") || len([]rune(n.Body)) > 500 || len([]rune(n.Transcript)) > 4000 {
			return Message{}, nil, ErrBadInput
		}
		if n.Kind == "voice" && (n.DurationMs <= 0 || n.DurationMs > 300000) {
			return Message{}, nil, ErrBadInput
		}
	case "party":
		if !partyRe.MatchString(n.PartyCode) || len([]rune(n.Body)) > 200 {
			return Message{}, nil, ErrBadInput
		}
	default:
		return Message{}, nil, ErrBadInput
	}
	var m Message
	var ids []string
	err := pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		kind, err := member(ctx, tx, conv, me)
		if err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `SELECT account_id::text FROM conversation_members WHERE conversation_id = $1`, conv)
		if err != nil {
			return err
		}
		if ids, err = pgx.CollectRows(rows, pgx.RowTo[string]); err != nil {
			return err
		}
		if kind == "dm" {
			for _, o := range ids {
				if o == me {
					continue
				}
				if f, err := areFriends(ctx, tx, me, o); err != nil || !f {
					if err == nil {
						err = ErrNotFriends
					}
					return err
				}
				if b, err := blockedEither(ctx, tx, me, o); err != nil || b {
					if err == nil {
						err = ErrBlocked
					}
					return err
				}
			}
		}
		if n.Kind == "party" {
			var ok bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM parties p JOIN party_members pm ON pm.party_id = p.id AND pm.account_id = $2 WHERE p.code = $1)`, n.PartyCode, me).Scan(&ok); err != nil {
				return err
			}
			if !ok {
				return ErrNotFound
			}
		}
		var media, transcript, party *string
		var dur *int
		if n.MediaKey != "" {
			media = &n.MediaKey
		}
		if n.Transcript != "" {
			transcript = &n.Transcript
		}
		if n.PartyCode != "" {
			party = &n.PartyCode
		}
		if n.Kind == "voice" {
			dur = &n.DurationMs
		}
		var id int64
		if err := tx.QueryRow(ctx, `INSERT INTO messages (conversation_id, sender_id, kind, body, media_key, duration_ms, transcript, party_code)
		  VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, conv, me, n.Kind, n.Body, media, dur, transcript, party).Scan(&id); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE conversations SET last_at = now() WHERE id = $1`, conv); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE conversation_members SET last_read = $3 WHERE conversation_id = $1 AND account_id = $2`, conv, me, id); err != nil {
			return err
		}
		m, err = scanMsg(tx.QueryRow(ctx, `SELECT `+msgCols+` FROM messages m`+msgJoins+` WHERE m.id = $1`, id))
		return err
	})
	return m, ids, err
}

// MarkRead records how far I have read and returns the chat's members to tell.
func (s Store) MarkRead(ctx context.Context, me, conv string, upto int64) ([]string, error) {
	var ids []string
	err := pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		if _, err := member(ctx, tx, conv, me); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE conversation_members SET last_read = greatest(last_read, least($3, coalesce((SELECT max(id) FROM messages WHERE conversation_id = $1), 0)))
		  WHERE conversation_id = $1 AND account_id = $2`, conv, me, upto); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `SELECT account_id::text FROM conversation_members WHERE conversation_id = $1`, conv)
		if err != nil {
			return err
		}
		ids, err = pgx.CollectRows(rows, pgx.RowTo[string])
		return err
	})
	return ids, err
}

// Members returns who is in a chat, if I am.
func (s Store) Members(ctx context.Context, me, conv string) ([]string, error) {
	var ids []string
	err := pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		if _, err := member(ctx, tx, conv, me); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `SELECT account_id::text FROM conversation_members WHERE conversation_id = $1`, conv)
		if err != nil {
			return err
		}
		ids, err = pgx.CollectRows(rows, pgx.RowTo[string])
		return err
	})
	return ids, err
}

// SetTranslate turns auto-translate on or off for me in one chat.
func (s Store) SetTranslate(ctx context.Context, me, conv string, on bool) error {
	tag, err := s.DB.Exec(ctx, `UPDATE conversation_members SET translate = $3 WHERE conversation_id::text = $1 AND account_id = $2`, conv, me, on)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotMember
	}
	return err
}

// CanSeeMedia says whether a stored file belongs to a chat I am in.
func (s Store) CanSeeMedia(ctx context.Context, me, key string) (bool, error) {
	if !mediaRe.MatchString(key) {
		return false, nil
	}
	var ok bool
	err := s.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM messages m JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.account_id = $1 WHERE m.media_key = $2)`, me, key).Scan(&ok)
	return ok, err
}

// CanUpload says whether I may add a file to a chat (I am a member).
func (s Store) CanUpload(ctx context.Context, me, conv string) error {
	_, err := s.Members(ctx, me, conv)
	return err
}

// Translation returns a cached translation, if any, of a message I can see.
func (s Store) Translation(ctx context.Context, me string, id int64, lang string) (src, body string, err error) {
	err = s.DB.QueryRow(ctx, `SELECT CASE WHEN m.kind = 'voice' THEN coalesce(m.transcript, '') ELSE m.body END, coalesce(t.body, '')
	  FROM messages m JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.account_id = $1
	  LEFT JOIN message_translations t ON t.message_id = m.id AND t.lang = $3 WHERE m.id = $2`, me, id, lang).Scan(&src, &body)
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrNotFound
	}
	return
}

func (s Store) SaveTranslation(ctx context.Context, id int64, lang, body string) error {
	_, err := s.DB.Exec(ctx, `INSERT INTO message_translations (message_id, lang, body) VALUES ($1, $2, left($3, 4000)) ON CONFLICT DO NOTHING`, id, lang, body)
	return err
}

// Report flags a message for moderators.
func (s Store) Report(ctx context.Context, me string, id int64, reason string) error {
	if !reasons[reason] {
		return ErrBadInput
	}
	tag, err := s.DB.Exec(ctx, `INSERT INTO chat_reports (reporter_id, reported_id, message_id, reason)
	  SELECT $1, m.sender_id, m.id, $3 FROM messages m JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.account_id = $1
	  WHERE m.id = $2 AND m.sender_id IS NOT NULL AND m.sender_id <> $1`, me, id, reason)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

// Unread counts unread messages across all my chats, for the badge.
func (s Store) Unread(ctx context.Context, me string) (int, error) {
	var n int
	err := s.DB.QueryRow(ctx, `SELECT count(*) FROM conversation_members cm JOIN messages m ON m.conversation_id = cm.conversation_id
	  AND m.id > cm.last_read AND m.sender_id IS DISTINCT FROM $1 WHERE cm.account_id = $1`, me).Scan(&n)
	return n, err
}

// CallPeer is the other person in a direct chat I may call: friends, and neither has
// blocked the other.
func (s Store) CallPeer(ctx context.Context, me, conv string) (string, error) {
	var peer string
	err := pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `SELECT om.account_id::text FROM conversations c
		  JOIN conversation_members mm ON mm.conversation_id = c.id AND mm.account_id = $2
		  JOIN conversation_members om ON om.conversation_id = c.id AND om.account_id <> $2
		  WHERE c.id::text = $1 AND c.kind = 'dm'`, conv, me).Scan(&peer)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotMember
		}
		if err != nil {
			return err
		}
		if b, err := blockedEither(ctx, tx, me, peer); err != nil || b {
			if err == nil {
				err = ErrBlocked
			}
			return err
		}
		if f, err := areFriends(ctx, tx, me, peer); err != nil || !f {
			if err == nil {
				err = ErrNotFriends
			}
			return err
		}
		return nil
	})
	return peer, err
}
