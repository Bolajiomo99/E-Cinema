package studios

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"
)

// Webhooks (Figma 39:1073): a studio's own systems hear about sales, premieres, payouts and
// leaks as they happen. Events are found each minute from the records themselves, queued once
// per endpoint, and delivered with retries. Every body is signed:
//
//	E-Cinema-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>" with the endpoint secret>

// HookEvents are the events an endpoint can subscribe to.
var HookEvents = []string{"ticket.sold", "premiere.started", "payout.sent", "leak.detected"}

// MaxHooks caps the endpoints one studio can register.
const MaxHooks = 5

var (
	ErrHookURL      = errors.New("use a public https:// address, without a username or password")
	ErrTooManyHooks = fmt.Errorf("a studio can have up to %d endpoints", MaxHooks)
)

type Hook struct {
	ID         string     `json:"id"`
	URL        string     `json:"url"`
	Events     []string   `json:"events"`
	Secret     string     `json:"secret,omitempty"` // only in the answer that creates the endpoint
	CreatedAt  time.Time  `json:"createdAt"`
	LastStatus *int       `json:"lastStatus"`
	LastEvent  string     `json:"lastEvent"`
	LastAt     *time.Time `json:"lastAt"`
	Failures   int        `json:"failures"`
	Pending    int        `json:"pending"`
}

// CheckHookURL accepts a public https address: no credentials, no IP literal in a private
// range, nothing on localhost. The address it resolves to is checked again on every delivery.
func CheckHookURL(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || len(raw) > 500 || u.Fragment != "" {
		return "", ErrHookURL
	}
	host := strings.ToLower(u.Hostname())
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".internal") || strings.HasSuffix(host, ".local") {
		return "", ErrHookURL
	}
	if ip, err := netip.ParseAddr(host); err == nil && !publicAddr(ip) {
		return "", ErrHookURL
	}
	if !strings.Contains(host, ".") {
		return "", ErrHookURL
	}
	return u.String(), nil
}

var cgnat = netip.MustParsePrefix("100.64.0.0/10")

func publicAddr(ip netip.Addr) bool {
	ip = ip.Unmap()
	return ip.IsValid() && !ip.IsLoopback() && !ip.IsPrivate() && !ip.IsLinkLocalUnicast() && !ip.IsLinkLocalMulticast() &&
		!ip.IsMulticast() && !ip.IsUnspecified() && !ip.IsInterfaceLocalMulticast() && !cgnat.Contains(ip)
}

// HookClient delivers webhooks: ten seconds per try, no redirects, and it refuses to connect
// to any address that is not public, whatever the name resolved to.
func HookClient() *http.Client {
	d := &net.Dialer{Timeout: 5 * time.Second, Control: func(_, address string, _ syscall.RawConn) error {
		host, _, err := net.SplitHostPort(address)
		if err != nil {
			return err
		}
		ip, err := netip.ParseAddr(host)
		if err != nil || !publicAddr(ip) {
			return fmt.Errorf("webhook address %s is not public", host)
		}
		return nil
	}}
	tr := &http.Transport{DialContext: d.DialContext, TLSHandshakeTimeout: 5 * time.Second, MaxIdleConns: 10, IdleConnTimeout: 30 * time.Second}
	return &http.Client{Timeout: 10 * time.Second, Transport: tr, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

func (st Store) hookStudio(ctx context.Context, acct, email string) (Studio, error) {
	return st.verified(ctx, acct, email, true)
}

const hookCols = `h.id, h.url, h.events, h.created_at, h.last_status, h.last_event, h.last_at, h.failures,
  (SELECT count(*) FROM studio_webhook_deliveries d WHERE d.hook = h.id AND d.status = 'pending')`

func scanHook(r pgx.CollectableRow) (Hook, error) {
	var h Hook
	err := r.Scan(&h.ID, &h.URL, &h.Events, &h.CreatedAt, &h.LastStatus, &h.LastEvent, &h.LastAt, &h.Failures, &h.Pending)
	return h, err
}

// Hooks lists the studio's endpoints. Only owners and admins see them, since a webhook address
// can carry a token of the studio's own.
func (st Store) Hooks(ctx context.Context, acct, email string) ([]Hook, error) {
	s, err := st.hookStudio(ctx, acct, email)
	if err != nil {
		return nil, err
	}
	rows, err := st.DB.Query(ctx, `SELECT `+hookCols+` FROM studio_webhooks h WHERE h.studio = $1 ORDER BY h.created_at`, s.Name)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanHook)
}

// AddHook registers an endpoint and returns it with its signing secret, shown this once.
func (st Store) AddHook(ctx context.Context, acct, email, rawURL string, events []string) (Hook, error) {
	s, err := st.hookStudio(ctx, acct, email)
	if err != nil {
		return Hook{}, err
	}
	u, err := CheckHookURL(rawURL)
	if err != nil {
		return Hook{}, err
	}
	var evs []string
	for _, e := range HookEvents {
		if slices.Contains(events, e) {
			evs = append(evs, e)
		}
	}
	if len(evs) == 0 || len(evs) != len(slices.Compact(slices.Sorted(slices.Values(events)))) {
		return Hook{}, ErrBadInput
	}
	var n int
	if err := st.DB.QueryRow(ctx, `SELECT count(*) FROM studio_webhooks WHERE studio = $1`, s.Name).Scan(&n); err != nil {
		return Hook{}, err
	}
	if n >= MaxHooks {
		return Hook{}, ErrTooManyHooks
	}
	b := make([]byte, 24)
	rand.Read(b)
	secret := "whsec_" + hex.EncodeToString(b)
	rows, err := st.DB.Query(ctx, `WITH h AS (INSERT INTO studio_webhooks (studio, url, secret, events, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *)
	  SELECT `+hookCols+` FROM h`, s.Name, u, secret, evs, acct)
	if err != nil {
		return Hook{}, err
	}
	h, err := pgx.CollectExactlyOneRow(rows, scanHook)
	h.Secret = secret
	return h, err
}

// DeleteHook removes an endpoint and anything still waiting to go to it.
func (st Store) DeleteHook(ctx context.Context, acct, email, id string) error {
	s, err := st.hookStudio(ctx, acct, email)
	if err != nil {
		return err
	}
	if !uuidRe.MatchString(id) {
		return ErrNotFound
	}
	tag, err := st.DB.Exec(ctx, `DELETE FROM studio_webhooks WHERE id = $1 AND studio = $2`, id, s.Name)
	if err == nil && tag.RowsAffected() == 0 {
		err = ErrNotFound
	}
	return err
}

// TestHook queues a "ping" event to the endpoint, sent within the minute.
func (st Store) TestHook(ctx context.Context, acct, email, id string, now time.Time) error {
	s, err := st.hookStudio(ctx, acct, email)
	if err != nil {
		return err
	}
	if !uuidRe.MatchString(id) {
		return ErrNotFound
	}
	data, _ := json.Marshal(map[string]any{"studio": s.Name, "message": "A test event from E-Cinema. Your endpoint is set up."})
	tag, err := st.DB.Exec(ctx, `INSERT INTO studio_webhook_deliveries (hook, event, dedupe, payload, next_at)
	  SELECT id, 'ping', 'ping:' || gen_random_uuid(), $3, $4 FROM studio_webhooks WHERE id = $1 AND studio = $2`, id, s.Name, string(data), now)
	if err == nil && tag.RowsAffected() == 0 {
		err = ErrNotFound
	}
	return err
}

// hookSources finds each event from its own records. $1 is now; every source row must be newer
// than the endpoint ($2 window start, and h.created_at), so a new endpoint is not flooded with
// the past.
var hookSources = []struct{ event, sql string }{
	{"ticket.sold", `SELECT h.id, 'ticket.sold:' || o.id, jsonb_build_object('orderId', o.id, 'showtimeId', s.id, 'film', s.film, 'seats', o.seats,
	    'amountCents', coalesce(o.net_cents, o.seats * s.price_cents), 'currency', s.currency, 'country', coalesce(a.country, ''), 'paidAt', o.paid_at)
	  FROM holds o JOIN showtimes s ON s.id = o.showtime_id LEFT JOIN accounts a ON a.id = o.account_id
	  JOIN studio_webhooks h ON h.studio = s.studio AND 'ticket.sold' = ANY(h.events)
	  WHERE o.status = 'paid' AND o.paid_at > $2 AND o.paid_at <= $1 AND o.paid_at >= h.created_at`},
	{"premiere.started", `SELECT h.id, 'premiere.started:' || s.id, jsonb_build_object('showtimeId', s.id, 'film', s.film, 'startsAt', s.starts_at,
	    'seatsSold', (SELECT coalesce(sum(o.seats), 0) FROM holds o WHERE o.showtime_id = s.id AND o.status = 'paid'))
	  FROM showtimes s JOIN studio_webhooks h ON h.studio = s.studio AND 'premiere.started' = ANY(h.events)
	  WHERE s.withdrawn_at IS NULL AND s.starts_at > $2 AND s.starts_at <= $1 AND s.starts_at >= h.created_at`},
	{"payout.sent", `SELECT h.id, 'payout.sent:' || p.showtime_id, jsonb_build_object('showtimeId', p.showtime_id, 'film', s.film, 'paidSeats', p.paid_seats,
	    'grossCents', p.gross_cents, 'amountCents', p.studio_cents, 'currency', p.currency, 'batchId', coalesce(p.paypal_batch_id, ''), 'sentAt', p.updated_at)
	  FROM studio_payouts p JOIN showtimes s ON s.id = p.showtime_id
	  JOIN studio_webhooks h ON h.studio = p.studio AND 'payout.sent' = ANY(h.events)
	  WHERE p.status = 'sent' AND p.updated_at > $2 AND p.updated_at <= $1 AND p.updated_at >= h.created_at`},
	{"leak.detected", `SELECT h.id, 'leak.detected:' || l.id, jsonb_build_object('leakId', l.id, 'showtimeId', coalesce(l.showtime_id, ''), 'film', coalesce(s.film, ''),
	    'kind', l.kind, 'place', l.place, 'link', l.link, 'status', l.status, 'reportedAt', l.created_at)
	  FROM studio_leaks l LEFT JOIN showtimes s ON s.id = l.showtime_id
	  JOIN studio_webhooks h ON h.studio = l.studio AND 'leak.detected' = ANY(h.events)
	  WHERE l.created_at > $2 AND l.created_at <= $1 AND l.created_at >= h.created_at`},
}

// QueueHookEvents queues every event of the last day not yet queued for each endpoint, and
// clears deliveries older than 30 days.
func (st Store) QueueHookEvents(ctx context.Context, now time.Time) (int, error) {
	n := 0
	for _, src := range hookSources {
		tag, err := st.DB.Exec(ctx, `INSERT INTO studio_webhook_deliveries (hook, event, dedupe, payload, next_at)
		  SELECT q.hook, $3, q.dedupe, q.payload, $1 FROM (`+strings.Replace(src.sql, "SELECT h.id,", "SELECT h.id hook,", 1)+`) q(hook, dedupe, payload)
		  ON CONFLICT (hook, dedupe) DO NOTHING`, now, now.Add(-24*time.Hour), src.event)
		if err != nil {
			return n, fmt.Errorf("webhook %s: %w", src.event, err)
		}
		n += int(tag.RowsAffected())
	}
	if _, err := st.DB.Exec(ctx, `DELETE FROM studio_webhook_deliveries WHERE status <> 'pending' AND created_at < $1`, now.AddDate(0, 0, -30)); err != nil {
		return n, err
	}
	return n, nil
}

// HookBackoff is the wait after each failed try; after the last, the delivery is given up.
var HookBackoff = []time.Duration{time.Minute, 5 * time.Minute, 30 * time.Minute, 2 * time.Hour, 8 * time.Hour}

// SignHook is the E-Cinema-Signature header for a body sent at t.
func SignHook(secret string, t time.Time, body []byte) string {
	ts := strconv.FormatInt(t.Unix(), 10)
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(ts + "."))
	m.Write(body)
	return "t=" + ts + ",v1=" + hex.EncodeToString(m.Sum(nil))
}

// DeliverHooks sends up to 25 due deliveries. A 2xx answer is delivered; anything else, or no
// answer, is tried again later.
func (st Store) DeliverHooks(ctx context.Context, client *http.Client, now time.Time) (sent, failed int, err error) {
	// Claim first, so a slow endpoint is not picked up twice.
	rows, err := st.DB.Query(ctx, `UPDATE studio_webhook_deliveries d SET next_at = $1::timestamptz + interval '5 minutes', attempts = d.attempts + 1
	  FROM studio_webhooks h WHERE h.id = d.hook AND d.id IN (
	    SELECT id FROM studio_webhook_deliveries WHERE status = 'pending' AND next_at <= $1 ORDER BY next_at LIMIT 25 FOR UPDATE SKIP LOCKED)
	  RETURNING d.id, d.hook, d.event, d.payload, d.attempts, d.created_at, h.url, h.secret`, now)
	if err != nil {
		return 0, 0, err
	}
	type job struct {
		id, hook, event, url, secret string
		payload                      json.RawMessage
		attempts                     int
		created                      time.Time
	}
	var jobs []job
	for rows.Next() {
		var j job
		if err := rows.Scan(&j.id, &j.hook, &j.event, &j.payload, &j.attempts, &j.created, &j.url, &j.secret); err != nil {
			rows.Close()
			return 0, 0, err
		}
		jobs = append(jobs, j)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, 0, err
	}
	for _, j := range jobs {
		body, _ := json.Marshal(map[string]any{"id": j.id, "type": j.event, "createdAt": j.created.UTC(), "data": j.payload})
		code := 0
		req, rerr := http.NewRequestWithContext(ctx, http.MethodPost, j.url, bytes.NewReader(body))
		if rerr == nil {
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("User-Agent", "E-Cinema-Webhooks/1")
			req.Header.Set("E-Cinema-Event", j.event)
			req.Header.Set("E-Cinema-Delivery", j.id)
			req.Header.Set("E-Cinema-Signature", SignHook(j.secret, now, body))
			if res, derr := client.Do(req); derr == nil {
				io.Copy(io.Discard, io.LimitReader(res.Body, 64<<10))
				res.Body.Close()
				code = res.StatusCode
			}
		}
		var status *int
		if code > 0 {
			status = &code
		}
		ok := code >= 200 && code < 300
		if ok {
			sent++
			_, err = st.DB.Exec(ctx, `UPDATE studio_webhook_deliveries SET status = 'sent', last_status = $2, sent_at = $3 WHERE id = $1`, j.id, status, now)
		} else {
			failed++
			if j.attempts > len(HookBackoff) {
				_, err = st.DB.Exec(ctx, `UPDATE studio_webhook_deliveries SET status = 'failed', last_status = $2 WHERE id = $1`, j.id, status)
			} else {
				_, err = st.DB.Exec(ctx, `UPDATE studio_webhook_deliveries SET last_status = $2, next_at = $3 WHERE id = $1`, j.id, status, now.Add(HookBackoff[j.attempts-1]))
			}
		}
		if err != nil {
			return sent, failed, err
		}
		if _, err = st.DB.Exec(ctx, `UPDATE studio_webhooks SET last_status = $2, last_event = $3, last_at = $4,
		    failures = CASE WHEN $5 THEN 0 ELSE failures + 1 END WHERE id = $1`, j.hook, code, j.event, now, ok); err != nil {
			return sent, failed, err
		}
	}
	return sent, failed, nil
}
