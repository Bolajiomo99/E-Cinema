// Package support is the help inbox: people write to the E-Cinema team from Help (or the AI
// concierge hands their question over), staff answer on the support desk, and every answer is
// emailed with a private link where the person can read the whole conversation and reply.
package support

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/mail"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Bolajiomo99/E-Cinema/api/internal/notify"
)

type Store struct {
	DB *pgxpool.Pool
	// Staff are told about new requests by email (the support desk is theirs).
	Staff []string
}

var (
	ErrBadInput = errors.New("please fill in every field")
	ErrNotFound = errors.New("no such request")
	ErrTooMany  = errors.New("you have sent several requests already; we will answer those first")
	ErrClosed   = errors.New("this request is closed; please start a new one")
)

var topics = map[string]bool{"payments": true, "playback": true, "languages": true, "account": true, "kids": true, "country": true, "other": true}

type New struct {
	AccountID string `json:"accountId"`
	Email     string `json:"email"`
	Name      string `json:"name"`
	Topic     string `json:"topic"`
	Subject   string `json:"subject"`
	Body      string `json:"body"`
	Via       string `json:"via"`
	Lang      string `json:"lang"`
}

type Message struct {
	Staff bool      `json:"staff"`
	Body  string    `json:"body"`
	At    time.Time `json:"at"`
}

type Request struct {
	ID        int64     `json:"id"`
	Token     string    `json:"token,omitempty"`
	Email     string    `json:"email"`
	Name      string    `json:"name"`
	Topic     string    `json:"topic"`
	Subject   string    `json:"subject"`
	Status    string    `json:"status"`
	Via       string    `json:"via"`
	Lang      string    `json:"lang"`
	Assignee  string    `json:"assignee"`
	Member    bool      `json:"member"` // opened from an account
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	Last      string    `json:"last"`      // the newest message, shortened, for lists
	LastStaff bool      `json:"lastStaff"` // the newest message is the team's
	Messages  []Message `json:"messages,omitempty"`
}

func clean(s string, max int) string {
	s = strings.TrimSpace(strings.ToValidUTF8(s, ""))
	if utf8.RuneCountInString(s) > max {
		s = string([]rune(s)[:max])
	}
	return s
}

func token() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// Open stores a new request with its first message, confirms it to the person and tells staff.
func (st Store) Open(ctx context.Context, n New, now time.Time) (Request, error) {
	n.Email = strings.ToLower(clean(n.Email, 254))
	n.Name, n.Subject, n.Body = clean(n.Name, 80), clean(n.Subject, 140), clean(n.Body, 5000)
	if a, err := mail.ParseAddress(n.Email); err != nil || a.Address != n.Email || !topics[n.Topic] || n.Subject == "" || n.Body == "" {
		return Request{}, ErrBadInput
	}
	if n.Via != "concierge" {
		n.Via = "form"
	}
	if len(n.Lang) > 3 {
		n.Lang = ""
	}
	var recent int
	if err := st.DB.QueryRow(ctx, `SELECT count(*) FROM support_requests WHERE email = $1 AND created_at > $2`, n.Email, now.Add(-24*time.Hour)).Scan(&recent); err != nil {
		return Request{}, err
	}
	if recent >= 5 {
		return Request{}, ErrTooMany
	}
	var account *string
	if n.AccountID != "" {
		account = &n.AccountID
	}
	r := Request{Token: token(), Email: n.Email, Name: n.Name, Topic: n.Topic, Subject: n.Subject, Status: "open", Via: n.Via, Lang: n.Lang, Member: account != nil, CreatedAt: now, UpdatedAt: now}
	tx, err := st.DB.Begin(ctx)
	if err != nil {
		return r, err
	}
	defer tx.Rollback(ctx)
	if err := tx.QueryRow(ctx, `INSERT INTO support_requests (token, account_id, email, name, topic, subject, via, lang, created_at, updated_at)
	  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING id`, r.Token, account, r.Email, r.Name, r.Topic, r.Subject, r.Via, r.Lang, now).Scan(&r.ID); err != nil {
		return r, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO support_messages (request_id, body, created_at) VALUES ($1, $2, $3)`, r.ID, n.Body, now); err != nil {
		return r, err
	}
	if err := tx.Commit(ctx); err != nil {
		return r, err
	}
	r.Messages = []Message{{Body: n.Body, At: now}}
	m := notify.Store{DB: st.DB}
	_ = m.Queue(ctx, notify.Mail{Kind: "support_received", To: r.Email, Name: r.Name, Dedupe: "support-received:" + r.Token,
		Data: map[string]any{"token": r.Token, "subject": r.Subject, "number": r.ID}})
	st.tellStaff(ctx, r, n.Body, now)
	return r, nil
}

func (st Store) tellStaff(ctx context.Context, r Request, body string, now time.Time) {
	m := notify.Store{DB: st.DB}
	for _, s := range st.Staff {
		if s = strings.ToLower(strings.TrimSpace(s)); s != "" {
			_ = m.Queue(ctx, notify.Mail{Kind: "support_new", To: s, Dedupe: "support-new:" + r.Token + ":" + s + ":" + now.UTC().Format("2006-01-02T15"),
				Data: map[string]any{"number": r.ID, "subject": r.Subject, "topic": r.Topic, "from": r.Email, "body": clean(body, 600)}})
		}
	}
}

const cols = `r.id, r.email, r.name, r.topic, r.subject, r.status, r.via, r.lang, coalesce(r.assignee, ''), r.account_id IS NOT NULL, r.created_at, r.updated_at,
  coalesce((SELECT left(body, 160) FROM support_messages WHERE request_id = r.id ORDER BY id DESC LIMIT 1), ''),
  coalesce((SELECT staff IS NOT NULL FROM support_messages WHERE request_id = r.id ORDER BY id DESC LIMIT 1), false)`

func scan(row pgx.Row) (Request, error) {
	var r Request
	err := row.Scan(&r.ID, &r.Email, &r.Name, &r.Topic, &r.Subject, &r.Status, &r.Via, &r.Lang, &r.Assignee, &r.Member, &r.CreatedAt, &r.UpdatedAt, &r.Last, &r.LastStaff)
	return r, err
}

func (st Store) messages(ctx context.Context, r *Request) error {
	rows, err := st.DB.Query(ctx, `SELECT staff IS NOT NULL, body, created_at FROM support_messages WHERE request_id = $1 ORDER BY id`, r.ID)
	if err != nil {
		return err
	}
	r.Messages, err = pgx.CollectRows(rows, pgx.RowToStructByPos[Message])
	return err
}

// ByToken is the conversation behind a private link.
func (st Store) ByToken(ctx context.Context, tok string) (Request, error) {
	r, err := scan(st.DB.QueryRow(ctx, `SELECT `+cols+` FROM support_requests r WHERE r.token = $1`, tok))
	if errors.Is(err, pgx.ErrNoRows) {
		return r, ErrNotFound
	}
	if err != nil {
		return r, err
	}
	r.Token = tok
	return r, st.messages(ctx, &r)
}

// Mine lists a member's requests, newest first, with their private links.
func (st Store) Mine(ctx context.Context, accountID string) ([]Request, error) {
	rows, err := st.DB.Query(ctx, `SELECT `+cols+`, r.token FROM support_requests r WHERE r.account_id = $1 ORDER BY r.updated_at DESC LIMIT 50`, accountID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Request, error) {
		var r Request
		err := row.Scan(&r.ID, &r.Email, &r.Name, &r.Topic, &r.Subject, &r.Status, &r.Via, &r.Lang, &r.Assignee, &r.Member, &r.CreatedAt, &r.UpdatedAt, &r.Last, &r.LastStaff, &r.Token)
		return r, err
	})
}

// Reply adds the person's answer from their private link and puts the request back in the queue.
func (st Store) Reply(ctx context.Context, tok, body string, now time.Time) (Request, error) {
	body = clean(body, 5000)
	if body == "" {
		return Request{}, ErrBadInput
	}
	r, err := st.ByToken(ctx, tok)
	if err != nil {
		return r, err
	}
	if r.Status == "closed" && now.Sub(r.UpdatedAt) > 14*24*time.Hour {
		return r, ErrClosed
	}
	if _, err := st.DB.Exec(ctx, `WITH m AS (INSERT INTO support_messages (request_id, body, created_at) VALUES ($1, $2, $3))
	  UPDATE support_requests SET status = 'open', updated_at = $3 WHERE id = $1`, r.ID, body, now); err != nil {
		return r, err
	}
	st.tellStaff(ctx, r, body, now)
	return st.ByToken(ctx, tok)
}

// Desk lists requests for staff: waiting ones first (oldest first, so nobody waits longest),
// then answered and closed ones.
func (st Store) Desk(ctx context.Context, status string) ([]Request, error) {
	q := `SELECT ` + cols + ` FROM support_requests r WHERE r.status = $1 ORDER BY r.updated_at LIMIT 100`
	if status != "open" {
		q = `SELECT ` + cols + ` FROM support_requests r WHERE r.status = $1 ORDER BY r.updated_at DESC LIMIT 100`
	}
	if status != "open" && status != "answered" && status != "closed" {
		return nil, ErrBadInput
	}
	rows, err := st.DB.Query(ctx, q, status)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Request, error) { return scan(row) })
}

// Counts is how many requests sit in each state, and how long the oldest open one has waited.
func (st Store) Counts(ctx context.Context, now time.Time) (map[string]int, int, error) {
	out := map[string]int{"open": 0, "answered": 0, "closed": 0}
	rows, err := st.DB.Query(ctx, `SELECT status, count(*) FROM support_requests GROUP BY status`)
	if err != nil {
		return out, 0, err
	}
	for rows.Next() {
		var s string
		var n int
		if err := rows.Scan(&s, &n); err != nil {
			rows.Close()
			return out, 0, err
		}
		out[s] = n
	}
	rows.Close()
	var oldest *time.Time
	if err := st.DB.QueryRow(ctx, `SELECT min(updated_at) FROM support_requests WHERE status = 'open'`).Scan(&oldest); err != nil {
		return out, 0, err
	}
	mins := 0
	if oldest != nil {
		mins = int(now.Sub(*oldest).Minutes())
	}
	return out, mins, nil
}

// Thread is one request with every message, for staff.
func (st Store) Thread(ctx context.Context, id int64) (Request, error) {
	r, err := scan(st.DB.QueryRow(ctx, `SELECT `+cols+` FROM support_requests r WHERE r.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return r, ErrNotFound
	}
	if err != nil {
		return r, err
	}
	return r, st.messages(ctx, &r)
}

// Answer posts a staff reply, emails it to the person with their private link, and marks the
// request answered (or closed). An empty body only changes the status.
func (st Store) Answer(ctx context.Context, id int64, staff, body string, close bool, now time.Time) (Request, error) {
	body = clean(body, 5000)
	staff = strings.ToLower(strings.TrimSpace(staff))
	if staff == "" || (body == "" && !close) {
		return Request{}, ErrBadInput
	}
	status := "answered"
	if close {
		status = "closed"
	}
	var tok, email, name, subject string
	err := st.DB.QueryRow(ctx, `UPDATE support_requests SET status = $2, updated_at = $3, assignee = coalesce(assignee, $4) WHERE id = $1
	  RETURNING token, email, name, subject`, id, status, now, staff).Scan(&tok, &email, &name, &subject)
	if errors.Is(err, pgx.ErrNoRows) {
		return Request{}, ErrNotFound
	}
	if err != nil {
		return Request{}, err
	}
	if body != "" {
		var mid int64
		if err := st.DB.QueryRow(ctx, `INSERT INTO support_messages (request_id, staff, body, created_at) VALUES ($1, $2, $3, $4) RETURNING id`, id, staff, body, now).Scan(&mid); err != nil {
			return Request{}, err
		}
		_ = notify.Store{DB: st.DB}.Queue(ctx, notify.Mail{Kind: "support_reply", To: email, Name: name, Dedupe: "support-reply:" + tok + ":" + strconv.FormatInt(mid, 10),
			Data: map[string]any{"token": tok, "subject": subject, "number": id, "body": body, "closed": close}})
	}
	return st.Thread(ctx, id)
}

