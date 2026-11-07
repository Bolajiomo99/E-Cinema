package studios_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/studios"
)

func TestCheckHookURL(t *testing.T) {
	for _, u := range []string{"https://api.starlight.ng/hooks", "https://hooks.example.com:8443/x?token=abc"} {
		if _, err := studios.CheckHookURL(u); err != nil {
			t.Fatalf("%s refused: %v", u, err)
		}
	}
	for _, u := range []string{"http://api.example.com", "https://localhost/x", "https://127.0.0.1/x", "https://10.0.0.4/x", "https://[::1]/x",
		"https://169.254.169.254/latest", "https://user:pw@example.com", "https://intranet/x", "https://db.internal/x", "ftp://example.com", "https://100.64.1.1/"} {
		if _, err := studios.CheckHookURL(u); !errors.Is(err, studios.ErrHookURL) {
			t.Fatalf("%s accepted", u)
		}
	}
}

func TestHookClientRefusesPrivate(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	defer srv.Close()
	if _, err := studios.HookClient().Get(srv.URL); err == nil || !strings.Contains(err.Error(), "not public") {
		t.Fatalf("loopback reached: %v", err)
	}
}

func TestWebhooks(t *testing.T) {
	p := pool(t)
	ctx := context.Background()
	st := studios.Store{DB: p}
	const name = "Test Hook Pictures"
	clean := func() {
		p.Exec(ctx, `DELETE FROM holds WHERE viewer_ref LIKE 'wh-%'`)
		p.Exec(ctx, `DELETE FROM studio_leaks WHERE studio = $1`, name)
		p.Exec(ctx, `DELETE FROM studios WHERE name = $1`, name)
		p.Exec(ctx, `DELETE FROM showtimes WHERE studio = $1`, name)
	}
	clean()
	t.Cleanup(clean)
	owner := account(t, p, "wh-owner@example.com", "Ada Obi", "NG")
	viewer := account(t, p, "wh-viewer@example.com", "Ife Ola", "NG")
	buyer := account(t, p, "wh-buyer@example.com", "Kemi Lawal", "GH")
	p.Exec(ctx, `INSERT INTO studios (name, slug, status, payout_email, verified_at, rights_at) VALUES ($1, 'test-hook-pictures', 'verified', 'x@example.com', now(), now())`, name)
	p.Exec(ctx, `INSERT INTO studio_members (studio, email, account_id, role) VALUES ($1, 'wh-owner@example.com', $2, 'owner'), ($1, 'wh-viewer@example.com', $3, 'viewer')`, name, owner, viewer)

	if _, err := st.Hooks(ctx, viewer, "wh-viewer@example.com"); !errors.Is(err, studios.ErrForbidden) {
		t.Fatalf("viewer saw webhooks: %v", err)
	}
	if _, err := st.AddHook(ctx, owner, "wh-owner@example.com", "https://hooks.example.com/x", []string{"ticket.sold", "nonsense"}); !errors.Is(err, studios.ErrBadInput) {
		t.Fatalf("unknown event: %v", err)
	}
	if _, err := st.AddHook(ctx, owner, "wh-owner@example.com", "https://10.1.1.1/x", []string{"ticket.sold"}); !errors.Is(err, studios.ErrHookURL) {
		t.Fatalf("private url: %v", err)
	}
	h, err := st.AddHook(ctx, owner, "wh-owner@example.com", "https://hooks.example.com/x", []string{"leak.detected", "ticket.sold"})
	if err != nil || !strings.HasPrefix(h.Secret, "whsec_") || len(h.Events) != 2 || h.Events[0] != "ticket.sold" {
		t.Fatalf("add: %+v %v", h, err)
	}
	list, _ := st.Hooks(ctx, owner, "wh-owner@example.com")
	if len(list) != 1 || list[0].Secret != "" {
		t.Fatalf("list leaks the secret or misses the hook: %+v", list)
	}

	// Point it at a local receiver (the add check refuses loopback, so set it directly).
	var mu sync.Mutex
	var got []map[string]any
	var sigs []string
	fail := true
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		mu.Lock()
		defer mu.Unlock()
		if fail {
			fail = false
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		var m map[string]any
		json.Unmarshal(b, &m)
		got = append(got, m)
		sigs = append(sigs, r.Header.Get("E-Cinema-Signature"))
		if r.Header.Get("E-Cinema-Signature") != studios.SignHook(h.Secret, time.Unix(0, 0).Add(sigTime(r.Header.Get("E-Cinema-Signature"))), b) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
	}))
	defer srv.Close()
	if _, err := p.Exec(ctx, `UPDATE studio_webhooks SET url = $2, created_at = now() - interval '1 hour' WHERE id = $1`, h.ID, srv.URL); err != nil {
		t.Fatal(err)
	}

	p.Exec(ctx, `INSERT INTO showtimes (id, film, studio, starts_at, duration_min, capacity, price_cents, currency) VALUES ('test-wh-1', 'Copper Tide', $1, now() - interval '10 minutes', 100, 40, 500, 'USD')`, name)
	p.Exec(ctx, `INSERT INTO holds (showtime_id, seats, viewer_ref, status, expires_at, account_id, paid_at, net_cents) VALUES
	  ('test-wh-1', 2, 'wh-1', 'paid', now(), $1, now() - interval '5 minutes', 1000),
	  ('test-wh-1', 1, 'wh-old', 'paid', now(), $1, now() - interval '3 hours', 500),
	  ('test-wh-1', 1, 'wh-2', 'held', now(), $1, NULL, NULL)`, buyer)
	p.Exec(ctx, `INSERT INTO studio_leaks (studio, showtime_id, kind, place, link, reported_by) VALUES ($1, 'test-wh-1', 'clip', 'tiktok', 'https://tiktok.com/x', $2)`, name, owner)

	now := time.Now()
	n, err := st.QueueHookEvents(ctx, now)
	if err != nil || n != 2 {
		t.Fatalf("queued %d (want the new sale and the leak; not the old sale, the premiere or the unpaid hold): %v", n, err)
	}
	if n, _ := st.QueueHookEvents(ctx, now); n != 0 {
		t.Fatalf("queued twice: %d", n)
	}
	client := srv.Client()
	sent, failed, err := st.DeliverHooks(ctx, client, now)
	if err != nil || sent != 1 || failed != 1 {
		t.Fatalf("first round sent %d failed %d: %v", sent, failed, err)
	}
	if sent, failed, _ = st.DeliverHooks(ctx, client, now); sent+failed != 0 {
		t.Fatal("the failed one was retried at once")
	}
	if sent, _, _ = st.DeliverHooks(ctx, client, now.Add(time.Minute+time.Second)); sent != 1 {
		t.Fatalf("retry after a minute sent %d", sent)
	}
	mu.Lock()
	if len(got) != 2 {
		t.Fatalf("received %d", len(got))
	}
	types := map[string]bool{}
	for _, m := range got {
		types[m["type"].(string)] = true
		if m["type"] == "ticket.sold" {
			d := m["data"].(map[string]any)
			if d["seats"].(float64) != 2 || d["amountCents"].(float64) != 1000 || d["country"] != "GH" || d["film"] != "Copper Tide" {
				t.Fatalf("ticket.sold data: %+v", d)
			}
		}
	}
	mu.Unlock()
	if !types["ticket.sold"] || !types["leak.detected"] {
		t.Fatalf("types: %v", types)
	}
	list, _ = st.Hooks(ctx, owner, "wh-owner@example.com")
	if list[0].LastStatus == nil || *list[0].LastStatus != 200 || list[0].Failures != 0 || list[0].Pending != 0 {
		t.Fatalf("hook state: %+v", list[0])
	}

	// A test ping, and an endpoint that never answers gives up after the last retry.
	if err := st.TestHook(ctx, owner, "wh-owner@example.com", h.ID, now); err != nil {
		t.Fatal(err)
	}
	if err := st.TestHook(ctx, owner, "wh-owner@example.com", "00000000-0000-0000-0000-000000000000", now); !errors.Is(err, studios.ErrNotFound) {
		t.Fatalf("other hook: %v", err)
	}
	srv.Close()
	at := now.Add(2 * time.Minute)
	for i := 0; i <= len(studios.HookBackoff); i++ {
		if _, f, err := st.DeliverHooks(ctx, client, at); err != nil || f != 1 {
			t.Fatalf("try %d failed=%d err=%v", i, f, err)
		}
		at = at.Add(9 * time.Hour)
	}
	var status string
	p.QueryRow(ctx, `SELECT status FROM studio_webhook_deliveries WHERE hook = $1 AND event = 'ping'`, h.ID).Scan(&status)
	list, _ = st.Hooks(ctx, owner, "wh-owner@example.com")
	if status != "failed" || list[0].Failures != len(studios.HookBackoff)+1 || *list[0].LastStatus != 0 {
		t.Fatalf("ping %s, hook %+v", status, list[0])
	}
	if err := st.DeleteHook(ctx, owner, "wh-owner@example.com", h.ID); err != nil {
		t.Fatal(err)
	}
	if list, _ = st.Hooks(ctx, owner, "wh-owner@example.com"); len(list) != 0 {
		t.Fatal("not deleted")
	}
}

func sigTime(h string) time.Duration {
	ts, _, _ := strings.Cut(strings.TrimPrefix(h, "t="), ",")
	var n int64
	for _, c := range ts {
		n = n*10 + int64(c-'0')
	}
	return time.Duration(n) * time.Second
}
