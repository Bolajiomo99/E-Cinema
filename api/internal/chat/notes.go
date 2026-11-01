package chat

import (
	"context"
	"fmt"
	"strconv"
)

// OfflineNote says what to tell a member who is not online about a new message: one note per
// unread streak, worded as a reply when they had sent a voice note just before.
func (s Store) OfflineNote(ctx context.Context, m Message, recipient string) (title, dedupe string, err error) {
	var prevSender, prevKind, convKind, convName string
	var lastRead int64
	err = s.DB.QueryRow(ctx, `SELECT c.kind, c.name, cm.last_read,
	    coalesce((SELECT sender_id::text FROM messages WHERE conversation_id = c.id AND id < $2 ORDER BY id DESC LIMIT 1), ''),
	    coalesce((SELECT kind FROM messages WHERE conversation_id = c.id AND id < $2 ORDER BY id DESC LIMIT 1), '')
	  FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.account_id = $3 WHERE c.id::text = $1`,
		m.ConversationID, m.ID, recipient).Scan(&convKind, &convName, &lastRead, &prevSender, &prevKind)
	if err != nil {
		return "", "", err
	}
	switch {
	case prevSender == recipient && prevKind == "voice":
		title = m.SenderName + " replied to your voice note"
	case convKind == "group":
		title = m.SenderName + " in " + convName
	default:
		title = m.SenderName + " sent you a message"
	}
	return title, "chat:" + m.ConversationID + ":" + strconv.FormatInt(lastRead, 10), nil
}

// Preview is the one-line summary of a message used in lists and notes.
func Preview(m Message) string {
	switch m.Kind {
	case "voice":
		s := (m.DurationMs + 500) / 1000
		return fmt.Sprintf("🎙 Voice note · %d:%02d", s/60, s%60)
	case "photo":
		if m.Body != "" {
			return "📷 " + m.Body
		}
		return "📷 Photo"
	case "party":
		if m.Party != nil {
			return "🎟 " + m.Party.Film + " watch party"
		}
		return "🎟 Watch party"
	}
	r := []rune(m.Body)
	if len(r) > 120 {
		return string(r[:119]) + "…"
	}
	return m.Body
}
