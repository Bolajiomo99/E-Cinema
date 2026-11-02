package careers_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/careers"
	"github.com/Bolajiomo99/E-Cinema/api/internal/db"
)

func TestCareers(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	p, err := db.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(p.Close)
	if err := db.Migrate(ctx, p); err != nil {
		t.Fatal(err)
	}
	st := careers.Store{DB: p}
	var me, abroad string
	for _, x := range []struct {
		email string
		id    *string
	}{{"careers-ng@example.com", &me}, {"careers-uk@example.com", &abroad}} {
		if err := p.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash) VALUES ($1, 'Ada', '!') ON CONFLICT (email) DO UPDATE SET name = 'Ada' RETURNING id`, x.email).Scan(x.id); err != nil {
			t.Fatal(err)
		}
	}
	clean := func() {
		p.Exec(ctx, `DELETE FROM jobs WHERE slug LIKE 'test-%'`)
		p.Exec(ctx, `DELETE FROM business_quotes WHERE email LIKE '%@example.com'`)
	}
	clean()
	t.Cleanup(clean)

	if _, err := st.SaveJob(ctx, careers.Job{Slug: "Bad Slug"}); !errors.Is(err, careers.ErrBadInput) {
		t.Fatalf("bad slug: %v", err)
	}
	ng := careers.Job{Slug: "test-go-engineer", Title: "Senior Go engineer, real-time", Team: "Platform", City: "Lagos", Country: "NG", Kind: "full", Quota: "ng", Pay: "₦18M to ₦26M a year", Setup: "Hybrid", About: "Build live sync.", Bring: "5+ years of Go.", Open: true}
	world := careers.Job{Slug: "test-android", Title: "Android engineer, Kotlin", Team: "Apps", City: "Remote", Country: "GB", Remote: true, Kind: "full", Quota: "world", About: "Build the app.", Bring: "Kotlin.", Open: true}
	for _, j := range []careers.Job{ng, world} {
		if _, err := st.SaveJob(ctx, j); err != nil {
			t.Fatal(err)
		}
	}
	b, err := st.Open(ctx, careers.Filter{Quota: "ng"})
	if err != nil || b.Nigeria < 1 || b.World < 1 || b.NGShare != 40 {
		t.Fatalf("board = %+v %v", b, err)
	}
	for _, j := range b.Jobs {
		if j.Quota != "ng" {
			t.Fatalf("quota filter let through %s", j.Slug)
		}
	}
	if b, _ := st.Open(ctx, careers.Filter{Kind: "remote", Q: "kotlin"}); len(b.Jobs) != 1 || b.Jobs[0].Slug != "test-android" {
		t.Fatalf("remote search = %+v", b.Jobs)
	}

	apply := careers.Applying{Name: "Chiamaka Eze", Email: "chiamaka@example.com", Country: "GB", CVKey: "careers/0b9b6a52-6f3e-4f9a-9a52-1d2b3c4d5e6f.pdf", Why: "Same night as London."}
	if _, err := st.Apply(ctx, abroad, ng.Slug, apply); !errors.Is(err, careers.ErrNotEligible) {
		t.Fatalf("not eligible: %v", err)
	}
	apply.NGEligible = true
	if _, err := st.Apply(ctx, abroad, ng.Slug, careers.Applying{Name: "x", Email: "x@example.com", Country: "GB", CVKey: "evil.pdf", NGEligible: true}); !errors.Is(err, careers.ErrBadInput) {
		t.Fatalf("bad cv key: %v", err)
	}
	a, err := st.Apply(ctx, abroad, ng.Slug, apply)
	if err != nil || a.Stage != "received" || len(a.Events) != 1 || !a.NGEligible {
		t.Fatalf("apply = %+v %v", a, err)
	}
	if _, err := st.Apply(ctx, abroad, ng.Slug, apply); !errors.Is(err, careers.ErrApplied) {
		t.Fatalf("twice: %v", err)
	}
	when := time.Now().Add(48 * time.Hour).Truncate(time.Minute)
	a, err = st.Advance(ctx, a.ID, careers.Move{Stage: "chat", InterviewAt: &when, InterviewWith: "Amaka (Head of Platform)"})
	if err != nil || a.Stage != "chat" || a.InterviewAt == nil || !a.InterviewAt.Equal(when) || len(a.Events) != 2 {
		t.Fatalf("chat = %+v %v", a, err)
	}
	due := time.Now().Add(7 * 24 * time.Hour)
	if a, err = st.Advance(ctx, a.ID, careers.Move{Stage: "task", TaskDue: &due, TaskPay: "₦150,000 for your time"}); err != nil || a.TaskPay == "" || a.TaskDue == nil {
		t.Fatalf("task = %+v %v", a, err)
	}
	if _, err := st.Advance(ctx, a.ID, careers.Move{Stage: "received"}); !errors.Is(err, careers.ErrBadInput) {
		t.Fatalf("backwards: %v", err)
	}
	if _, err := st.Advance(ctx, a.ID, careers.Move{Stage: "closed"}); !errors.Is(err, careers.ErrBadInput) {
		t.Fatalf("close without why: %v", err)
	}
	mine, err := st.Mine(ctx, abroad)
	if err != nil || len(mine) == 0 || mine[0].CVKey != "" {
		t.Fatalf("mine = %+v %v", mine, err)
	}
	if err := st.Withdraw(ctx, abroad, a.ID); err != nil {
		t.Fatal(err)
	}
	if err := st.Withdraw(ctx, abroad, a.ID); !errors.Is(err, careers.ErrNotFound) {
		t.Fatalf("withdraw twice: %v", err)
	}
	// A closed role takes no more applications.
	world.Open = false
	st.SaveJob(ctx, world)
	if _, err := st.Apply(ctx, me, world.Slug, careers.Applying{Name: "Ada", Email: "ada@example.com", Country: "NG", CVKey: apply.CVKey}); !errors.Is(err, careers.ErrClosed) {
		t.Fatalf("closed: %v", err)
	}

	q, err := st.AskQuote(ctx, careers.Quote{Organisation: "Zenith Group", Email: "events@zenith.example.com", Guests: 2000, Country: "ng", Kind: "company"})
	if err != nil || q.Status != "new" || q.Country != "NG" {
		t.Fatalf("quote = %+v %v", q, err)
	}
	if _, err := st.AskQuote(ctx, careers.Quote{Organisation: "X", Email: "x@example.com", Guests: 60000, Country: "NG"}); !errors.Is(err, careers.ErrBadInput) {
		t.Fatalf("too many guests: %v", err)
	}
	if err := st.SetQuote(ctx, q.ID, "contacted"); err != nil {
		t.Fatal(err)
	}
}
