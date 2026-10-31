// Package rooms runs the live side of a screening: chat, reactions and who is in the room.
//
// Only ticket holders get in. The web app asks for a short-lived room pass on the viewer's
// behalf, and the browser opens a WebSocket with it. Messages are stored so people who join
// late can scroll back; reactions and the head count are live only.
package rooms

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNoTicket = errors.New("no ticket for this screening")
	ErrBadPass  = errors.New("room pass is invalid or expired")
	ErrEmpty    = errors.New("message is empty or too long")
	ErrTooFast  = errors.New("slow down: too many messages")
)

const (
	MaxRunes  = 500
	PassFor   = 5 * time.Minute
	burstGap  = time.Second // at most one message a second
	perMinute = 20
)

// Reactions people can send; anything else is ignored.
var Reactions = map[string]bool{"🔥": true, "😂": true, "😮": true, "❤️": true, "👏": true, "😭": true}

type Message struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	Body      string    `json:"body"`
	Mine      bool      `json:"mine,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

type Store struct{ DB *pgxpool.Pool }

// Recent returns the latest visible messages, oldest first.
func (st Store) Recent(ctx context.Context, showtimeID, viewerID string, limit int) ([]Message, error) {
	rows, err := st.DB.Query(ctx, `SELECT id, name, body, account_id = $2, created_at FROM (
	    SELECT * FROM room_messages WHERE showtime_id = $1 AND NOT hidden ORDER BY id DESC LIMIT $3
	  ) m ORDER BY id`, showtimeID, viewerID, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Message, error) {
		var m Message
		err := r.Scan(&m.ID, &m.Name, &m.Body, &m.Mine, &m.CreatedAt)
		return m, err
	})
}

// Clean trims a message and strips control characters; it returns ErrEmpty when nothing is left.
func Clean(body string) (string, error) {
	body = strings.Map(func(r rune) rune {
		if r == '\n' {
			return ' '
		}
		if unicode.IsControl(r) || r == '​' || r == '‮' {
			return -1
		}
		return r
	}, body)
	body = strings.TrimSpace(body)
	if body == "" || utf8.RuneCountInString(body) > MaxRunes {
		return "", ErrEmpty
	}
	return body, nil
}

// Post stores a message. Rate limits are checked inside the same transaction, with the
// account's earlier messages locked, so two tabs cannot slip past them together.
func (st Store) Post(ctx context.Context, showtimeID, accountID, name, body string) (Message, error) {
	body, err := Clean(body)
	if err != nil {
		return Message{}, err
	}
	var m Message
	err = pgx.BeginFunc(ctx, st.DB, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('room-msg:' || $1))`, accountID); err != nil {
			return err
		}
		var lastMinute int
		var last *time.Time
		if err := tx.QueryRow(ctx, `SELECT count(*) FILTER (WHERE created_at > now() - interval '1 minute'), max(created_at)
		  FROM room_messages WHERE account_id = $1 AND created_at > now() - interval '1 minute'`, accountID).Scan(&lastMinute, &last); err != nil {
			return err
		}
		if lastMinute >= perMinute || (last != nil && time.Since(*last) < burstGap) {
			return ErrTooFast
		}
		m = Message{Name: name, Body: body, Mine: true}
		return tx.QueryRow(ctx, `INSERT INTO room_messages (showtime_id, account_id, name, body)
		  VALUES ($1, $2, $3, $4) RETURNING id, created_at`, showtimeID, accountID, name, body).Scan(&m.ID, &m.CreatedAt)
	})
	return m, err
}

// Pass is what a room pass proves: who is entering which screening, until when.
type Pass struct {
	AccountID  string
	ShowtimeID string
	Name       string
	Expires    time.Time
	Country    string // two-letter home country, for the room's "N countries" count
}

// Passes signs and checks room passes with a key only the API knows.
type Passes struct{ Key []byte }

func (p Passes) Issue(pass Pass) string {
	fields := []string{pass.AccountID, pass.ShowtimeID, strconv.FormatInt(pass.Expires.Unix(), 10), pass.Name}
	if pass.Country != "" {
		fields = append(fields, pass.Country)
	}
	payload := strings.Join(fields, "\x1f")
	enc := base64.RawURLEncoding.EncodeToString([]byte(payload))
	return enc + "." + base64.RawURLEncoding.EncodeToString(p.sign(enc))
}

func (p Passes) Check(token, showtimeID string, now time.Time) (Pass, error) {
	enc, sig, ok := strings.Cut(token, ".")
	if !ok || len(p.Key) == 0 {
		return Pass{}, ErrBadPass
	}
	got, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil || !hmac.Equal(got, p.sign(enc)) {
		return Pass{}, ErrBadPass
	}
	raw, err := base64.RawURLEncoding.DecodeString(enc)
	if err != nil {
		return Pass{}, ErrBadPass
	}
	parts := strings.SplitN(string(raw), "\x1f", 5)
	if len(parts) < 4 {
		return Pass{}, ErrBadPass
	}
	country := ""
	if len(parts) == 5 {
		country = parts[4]
	}
	exp, err := strconv.ParseInt(parts[2], 10, 64)
	if err != nil || now.Unix() > exp || parts[1] != showtimeID {
		return Pass{}, ErrBadPass
	}
	return Pass{AccountID: parts[0], ShowtimeID: parts[1], Expires: time.Unix(exp, 0), Name: parts[3], Country: country}, nil
}

func (p Passes) sign(s string) []byte {
	m := hmac.New(sha256.New, p.Key)
	m.Write([]byte("room-pass-v1\x00" + s))
	return m.Sum(nil)
}

// ViewerCode is a short, stable code burned into the picture so a leaked recording points
// back to the account that made it, without showing anyone's name or email.
func ViewerCode(key []byte, accountID string) string {
	m := hmac.New(sha256.New, key)
	m.Write([]byte("viewer-code-v1\x00" + accountID))
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	sum := m.Sum(nil)
	out := make([]byte, 7)
	for i := range out {
		out[i] = alphabet[int(sum[i])%len(alphabet)]
	}
	return string(out[:2]) + "-" + string(out[2:])
}
