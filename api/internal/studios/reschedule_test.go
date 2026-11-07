package studios_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/studios"
)

func TestRescheduleWithdraw(t *testing.T) {
	p := pool(t)
	ctx := context.Background()
	st := studios.Store{DB: p}
	const name, email = "Test Move Pictures", "mv-owner@example.com"
	clean := func() {
		p.Exec(ctx, `DELETE FROM mail_outbox WHERE to_email LIKE 'mv-%'`)
		p.Exec(ctx, `DELETE FROM holds WHERE showtime_id IN (SELECT id FROM showtimes WHERE studio = $1)`, name)
		p.Exec(ctx, `DELETE FROM studios WHERE name = $1`, name)
		p.Exec(ctx, `DELETE FROM showtimes WHERE studio = $1`, name)
	}
	clean()
	t.Cleanup(clean)
	owner := account(t, p, email, "Ada Obi", "NG")
	editor := account(t, p, "mv-editor@example.com", "Tolu Ade", "NG")
	buyer := account(t, p, "mv-buyer@example.com", "Kemi Lawal", "NG")
	p.Exec(ctx, `INSERT INTO studios (name, slug, status, payout_email, verified_at, rights_at) VALUES ($1, 'test-move-pictures', 'verified', 'x@example.com', now(), now())`, name)
	p.Exec(ctx, `INSERT INTO studio_members (studio, email, account_id, role) VALUES ($1, $2, $3, 'owner'), ($1, 'mv-editor@example.com', $4, 'admin')`, name, email, owner, editor)
	u, err := st.CreateUpload(ctx, owner, email, "River of Glass")
	if err != nil {
		t.Fatal(err)
	}
	if plan, err := st.PlanOf(ctx, owner, email, u.ID); err != nil || plan != nil {
		t.Fatalf("plan before publish: %+v %v", plan, err)
	}
	m, _ := st.AddFile(ctx, owner, email, u.ID, "Glass_MASTER.mov", 1000)
	done := "uploaded"
	st.UpdateFile(ctx, owner, email, u.ID, m.ID, studios.FileUpdate{Status: &done})
	now := time.Now()
	pub, err := st.SavePremiere(ctx, owner, email, u.ID, studios.PremiereInput{Mode: "global", StartsAt: now.Add(72 * time.Hour), Seats: 500, PriceCents: 500, DurationMin: 100, Publish: true}, now)
	if err != nil || pub.ShowtimeID == nil {
		t.Fatalf("publish: %+v %v", pub, err)
	}
	sid := *pub.ShowtimeID
	p.Exec(ctx, `INSERT INTO holds (showtime_id, seats, viewer_ref, status, expires_at, account_id, paypal_order_id, paypal_capture_id, net_cents, paid_at)
	  VALUES ($1, 2, 'mv1', 'paid', now(), $2, 'o1', 'CAP-mv1', 1000, now()), ($1, 1, 'mv2', 'held', now() + interval '5 minutes', $2, 'o2', NULL, NULL, NULL)`, sid, buyer)

	plan, err := st.PlanOf(ctx, editor, "mv-editor@example.com", u.ID)
	if err != nil || plan == nil || plan.Seats != 2 || plan.Holders != 1 || plan.GrossCents != 1000 || plan.SharePct != 70 || plan.Week != 2 {
		t.Fatalf("plan: %+v %v", plan, err)
	}
	sales, err := st.SalesOf(ctx, editor, "mv-editor@example.com", u.ID, now)
	if err != nil || sales == nil || sales.Seats != 2 || sales.GrossCents != 1000 || len(sales.Days) != 14 || sales.Days[13].Seats != 2 || len(sales.Countries) != 1 || sales.Countries[0].Country != "NG" {
		t.Fatalf("sales: %+v %v", sales, err)
	}
	if _, err := st.Reschedule(ctx, editor, "mv-editor@example.com", u.ID, now.Add(2*time.Hour), now); !errors.Is(err, studios.ErrBadInput) {
		t.Fatalf("too soon: %v", err)
	}
	to := now.Add(96 * time.Hour)
	moved, err := st.Reschedule(ctx, editor, "mv-editor@example.com", u.ID, to, now)
	if err != nil || moved.MovedFrom == nil || !moved.StartsAt.Equal(to.UTC().Truncate(time.Minute)) {
		t.Fatalf("move: %+v %v", moved, err)
	}
	var mails, until int
	p.QueryRow(ctx, `SELECT count(*) FROM mail_outbox WHERE kind = 'premiere_moved' AND to_email = 'mv-buyer@example.com'`).Scan(&mails)
	p.QueryRow(ctx, `SELECT count(*) FROM holds WHERE showtime_id = $1 AND refund_until > now() + interval '6 days'`, sid).Scan(&until)
	if mails != 1 || until != 1 {
		t.Fatalf("moved mail %d, refund window %d", mails, until)
	}
	if _, err := st.Withdraw(ctx, editor, "mv-editor@example.com", u.ID, now); !errors.Is(err, studios.ErrForbidden) {
		t.Fatalf("editor withdraws: %v", err)
	}
	gone, err := st.Withdraw(ctx, owner, email, u.ID, now)
	if err != nil || gone.WithdrawnAt == nil || gone.RefundsDue != 1 {
		t.Fatalf("withdraw: %+v %v", gone, err)
	}
	var held int
	p.QueryRow(ctx, `SELECT count(*) FROM holds WHERE showtime_id = $1 AND status = 'held'`, sid).Scan(&held)
	if held != 0 {
		t.Fatalf("held seats left: %d", held)
	}
	due, err := st.RefundsDue(ctx, 50)
	found := ""
	for _, d := range due {
		if d.CaptureID == "CAP-mv1" {
			found = d.HoldID
		}
	}
	if err != nil || found == "" {
		t.Fatalf("refunds due: %+v %v", due, err)
	}
	if err := st.SettleFreeSeat(ctx, found); err != nil {
		t.Fatal(err)
	}
	if plan, _ := st.PlanOf(ctx, owner, email, u.ID); plan.RefundsDue != 0 || plan.Seats != 0 {
		t.Fatalf("after settle: %+v", plan)
	}
	if _, err := st.Reschedule(ctx, owner, email, u.ID, now.Add(120*time.Hour), now); !errors.Is(err, studios.ErrBadInput) {
		t.Fatalf("move withdrawn: %v", err)
	}
}
