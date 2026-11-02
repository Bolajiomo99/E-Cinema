package studios_test

import (
	"context"
	"errors"
	"testing"

	"github.com/Bolajiomo99/E-Cinema/api/internal/studios"
)

func TestMarketing(t *testing.T) {
	p := pool(t)
	ctx := context.Background()
	st := studios.Store{DB: p}
	const name, email = "Test Market Films", "mk-owner@example.com"
	clean := func() {
		p.Exec(ctx, `DELETE FROM holds WHERE showtime_id = 'test-mk-1'`)
		p.Exec(ctx, `DELETE FROM studio_campaigns WHERE studio = $1`, name)
		p.Exec(ctx, `DELETE FROM studio_uploads WHERE studio = $1`, name)
		p.Exec(ctx, `DELETE FROM studios WHERE name = $1`, name)
		p.Exec(ctx, `DELETE FROM showtimes WHERE id IN ('test-mk-1', 'test-mk-other')`)
	}
	clean()
	t.Cleanup(clean)
	owner := account(t, p, email, "Ada Obi", "NG")
	mkt := account(t, p, "mk-mkt@example.com", "Bisi Ade", "NG")
	viewer := account(t, p, "mk-viewer@example.com", "Ife Ola", "NG")
	buyer := account(t, p, "mk-buyer@example.com", "Tolu Ade", "NG")
	p.Exec(ctx, `INSERT INTO studios (name, slug, status, payout_email, verified_at) VALUES ($1, 'test-market-films', 'verified', 'x@example.com', now())`, name)
	p.Exec(ctx, `INSERT INTO studio_members (studio, email, account_id, role) VALUES ($1, $2, $3, 'owner'), ($1, 'mk-mkt@example.com', $4, 'marketing'), ($1, 'mk-viewer@example.com', $5, 'viewer')`, name, email, owner, mkt, viewer)
	p.Exec(ctx, `INSERT INTO showtimes (id, film, studio, starts_at, duration_min, capacity, price_cents, currency) VALUES ('test-mk-1', 'Blade of Kumo', $1, now() + interval '3 days', 120, 100, 700, 'USD'), ('test-mk-other', 'Not Ours', 'Someone Else', now(), 90, 10, 500, 'USD')`, name)

	in := studios.CampaignInput{ShowtimeID: "test-mk-1", Name: "Anime fans · Japan, Brazil", Channel: "clips", CostCents: 4100}
	if _, err := st.CreateCampaign(ctx, viewer, "mk-viewer@example.com", in); !errors.Is(err, studios.ErrForbidden) {
		t.Fatalf("viewer creates: %v", err)
	}
	other := in
	other.ShowtimeID = "test-mk-other"
	if _, err := st.CreateCampaign(ctx, mkt, "mk-mkt@example.com", other); !errors.Is(err, studios.ErrBadInput) {
		t.Fatalf("someone else's film: %v", err)
	}
	c, err := st.CreateCampaign(ctx, mkt, "mk-mkt@example.com", in)
	if err != nil || len(c.Code) != 8 || c.Film != "Blade of Kumo" {
		t.Fatalf("create: %+v %v", c, err)
	}
	sid, err := st.CampaignVisit(ctx, c.Code)
	if err != nil || sid != "test-mk-1" {
		t.Fatalf("visit: %s %v", sid, err)
	}
	st.CampaignVisit(ctx, c.Code)
	if _, err := st.CampaignVisit(ctx, "zzzzzzzz"); !errors.Is(err, studios.ErrNoCampaign) {
		t.Fatalf("unknown code: %v", err)
	}
	var hold string
	p.QueryRow(ctx, `INSERT INTO holds (showtime_id, seats, viewer_ref, status, expires_at, account_id) VALUES ('test-mk-1', 3, 'mk', 'paid', now(), $1) RETURNING id`, buyer).Scan(&hold)
	if err := st.Attribute(ctx, hold, c.Code); err != nil {
		t.Fatal(err)
	}
	list, err := st.Campaigns(ctx, viewer, "mk-viewer@example.com")
	if err != nil || len(list) != 1 || list[0].Clicks != 2 || list[0].Seats != 3 || list[0].Orders != 1 || list[0].GrossCents != 2100 {
		t.Fatalf("list: %+v %v", list, err)
	}
	if got, err := st.SetCampaignCost(ctx, owner, email, c.ID, 9900); err != nil || got.CostCents != 9900 {
		t.Fatalf("cost: %+v %v", got, err)
	}

	u, err := st.CreateUpload(ctx, owner, email, "Blade of Kumo")
	if err != nil {
		t.Fatal(err)
	}
	clips := []studios.Clip{{StartMs: 60000, EndMs: 75000, Title: "First draw", Why: "The first duel", Format: "9:16"}, {StartMs: 120000, EndMs: 142000, Title: "The promise", Format: "1:1"}}
	if _, err := st.SaveClips(ctx, owner, email, u.ID, 100000, clips); !errors.Is(err, studios.ErrBadInput) {
		t.Fatalf("past the cutoff: %v", err)
	}
	got, err := st.SaveClips(ctx, mkt, "mk-mkt@example.com", u.ID, 3000000, clips)
	if err != nil || len(got.Clips) != 2 || got.CutoffMs != 3000000 {
		t.Fatalf("save: %+v %v", got, err)
	}
	if got, err = st.ApproveClips(ctx, mkt, "mk-mkt@example.com", u.ID, []int{1}); err != nil || got.Clips[0].Approved || !got.Clips[1].Approved {
		t.Fatalf("approve: %+v %v", got, err)
	}
	if err := st.DeleteCampaign(ctx, owner, email, c.ID); err != nil {
		t.Fatal(err)
	}
	var linked *string
	p.QueryRow(ctx, `SELECT campaign_id FROM holds WHERE id = $1`, hold).Scan(&linked)
	if linked != nil {
		t.Fatal("hold still linked to a deleted campaign")
	}
}
