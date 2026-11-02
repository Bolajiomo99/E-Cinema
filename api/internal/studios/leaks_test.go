package studios_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
	"github.com/Bolajiomo99/E-Cinema/api/internal/rooms"
	"github.com/Bolajiomo99/E-Cinema/api/internal/studios"
)

func TestLeaks(t *testing.T) {
	p := pool(t)
	ctx := context.Background()
	st := studios.Store{DB: p}
	acc := accounts.Store{DB: p}
	key := []byte("test-pass-key-0123456789abcdef")
	codeOf := func(id string) string { return rooms.ViewerCode(key, id) }
	const name, email = "Test Leak Films", "lk-owner@example.com"
	clean := func() {
		p.Exec(ctx, `DELETE FROM studio_leaks WHERE studio = $1`, name)
		p.Exec(ctx, `DELETE FROM holds WHERE showtime_id = 'test-lk-1'`)
		p.Exec(ctx, `DELETE FROM studios WHERE name = $1`, name)
		p.Exec(ctx, `DELETE FROM showtimes WHERE id = 'test-lk-1'`)
		p.Exec(ctx, `DELETE FROM accounts WHERE email LIKE 'lk-%@example.com'`)
	}
	clean()
	t.Cleanup(clean)
	owner := account(t, p, email, "Ada Obi", "NG")
	viewer := account(t, p, "lk-viewer@example.com", "Ife Ola", "NG")
	pirate := account(t, p, "lk-pirate@example.com", "Kay Ldn", "GB")
	p.Exec(ctx, `INSERT INTO studios (name, slug, status, payout_email, verified_at) VALUES ($1, 'test-leak-films', 'verified', 'x@example.com', now())`, name)
	p.Exec(ctx, `INSERT INTO studio_members (studio, email, account_id, role) VALUES ($1, $2, $3, 'owner'), ($1, 'lk-viewer@example.com', $4, 'viewer')`, name, email, owner, viewer)
	p.Exec(ctx, `INSERT INTO showtimes (id, film, studio, starts_at, duration_min, capacity, price_cents, currency) VALUES ('test-lk-1', 'Orbit Zero', $1, now() - interval '2 days', 100, 10, 700, 'USD')`, name)
	p.Exec(ctx, `INSERT INTO holds (showtime_id, seats, viewer_ref, status, expires_at, account_id) VALUES ('test-lk-1', 1, 'lk', 'paid', now(), $1)`, pirate)

	in := studios.LeakInput{ShowtimeID: "test-lk-1", Kind: "clip", Place: "telegram", Link: "https://t.me/somechannel/12", What: "2 clips (01:02:10, 01:15:44)", Code: codeOf(pirate)}
	if _, err := st.ReportLeak(ctx, viewer, "lk-viewer@example.com", in, codeOf); !errors.Is(err, studios.ErrForbidden) {
		t.Fatalf("viewer reports: %v", err)
	}
	bad := in
	bad.Link = "javascript:alert(1)"
	if _, err := st.ReportLeak(ctx, owner, email, bad, codeOf); !errors.Is(err, studios.ErrBadInput) {
		t.Fatalf("bad link: %v", err)
	}
	l, err := st.ReportLeak(ctx, owner, email, in, codeOf)
	if err != nil || !l.Traced || l.Country != "GB" || l.Film != "Orbit Zero" || l.Status != "open" {
		t.Fatalf("report: %+v %v", l, err)
	}
	// A code no ticket holder has stays untraced; codes typed without the dash still match.
	other := in
	other.Code, other.Kind, other.Place, other.Link = "ZZ-ZZZZZ", "full", "website", "https://streamcloud.example/orbit"
	u, err := st.ReportLeak(ctx, owner, email, other, codeOf)
	if err != nil || u.Traced {
		t.Fatalf("untraced: %+v %v", u, err)
	}
	nodash := in
	nodash.Code = codeOf(pirate)[:2] + codeOf(pirate)[3:]
	if n, err := st.ReportLeak(ctx, owner, email, nodash, codeOf); err != nil || !n.Traced || n.Code != codeOf(pirate) {
		t.Fatalf("no dash: %+v %v", n, err)
	}

	if _, err := st.UpdateLeak(ctx, owner, email, u.ID, studios.LeakUpdate{Ban: true}); !errors.Is(err, studios.ErrBadInput) {
		t.Fatalf("ban untraced: %v", err)
	}
	sent := "takedown_sent"
	notice := "To the host: please remove this copy."
	got, err := st.UpdateLeak(ctx, owner, email, l.ID, studios.LeakUpdate{Status: &sent, Notice: &notice, Ban: true})
	if err != nil || got.Status != "takedown_sent" || got.SentAt == nil || got.Notice != notice || got.Ban != "requested" {
		t.Fatalf("update: %+v %v", got, err)
	}
	down := "taken_down"
	if got, err = st.UpdateLeak(ctx, owner, email, l.ID, studios.LeakUpdate{Status: &down}); err != nil || got.TakenDownAt == nil {
		t.Fatalf("down: %+v %v", got, err)
	}

	// Staff close the account: every device is signed out and no sign-in works.
	if _, _, err := acc.SignIn(ctx, "lk-pirate@example.com", "x", "web"); err == nil {
		t.Fatal("password '!' should never match")
	}
	p.Exec(ctx, `INSERT INTO account_sessions (account_id, token_hash, device, expires_at) VALUES ($1, 'lk-hash', 'web', now() + interval '1 day')`, pirate)
	reqs, err := st.BanRequests(ctx)
	found := false
	for _, r := range reqs {
		found = found || r.ID == l.ID && r.AccountID == pirate
	}
	if err != nil || !found {
		t.Fatalf("requests: %+v %v", reqs, err)
	}
	if err := st.DecideBan(ctx, l.ID, true, func(a, reason string) error { return acc.Ban(ctx, a, reason) }); err != nil {
		t.Fatal(err)
	}
	var banned, live bool
	p.QueryRow(ctx, `SELECT banned_at IS NOT NULL, EXISTS (SELECT 1 FROM account_sessions WHERE account_id = $1 AND revoked_at IS NULL) FROM accounts WHERE id = $1`, pirate).Scan(&banned, &live)
	if !banned || live {
		t.Fatalf("banned %v, sessions still live %v", banned, live)
	}
	if _, _, _, err := acc.SignInExternal(ctx, "google", "lk-sub", "lk-pirate@example.com", true, "Kay", "web"); !errors.Is(err, accounts.ErrBanned) {
		t.Fatalf("banned sign-in: %v", err)
	}

	list, stats, err := st.Leaks(ctx, owner, email, time.Now())
	if err != nil || len(list) != 3 || stats.Found30 != 3 || stats.TakenDown != 1 || stats.Banned != 1 || stats.Traced != 2 {
		t.Fatalf("leaks: %d %+v %v", len(list), stats, err)
	}
	if err := st.DecideBan(ctx, l.ID, true, nil); !errors.Is(err, studios.ErrNoLeak) {
		t.Fatalf("decided twice: %v", err)
	}
}
