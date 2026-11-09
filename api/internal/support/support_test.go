package support_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/db"
	"github.com/Bolajiomo99/E-Cinema/api/internal/support"
)

func TestInbox(t *testing.T) {
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
	clean := func() {
		p.Exec(ctx, `DELETE FROM support_requests WHERE email LIKE '%@support-test.example'`)
		p.Exec(ctx, `DELETE FROM mail_outbox WHERE to_email LIKE '%@support-test.example' OR (kind = 'support_new' AND to_email = 'desk@support-test.example')`)
	}
	clean()
	t.Cleanup(clean)
	st := support.Store{DB: p, Staff: []string{"desk@support-test.example"}}
	now := time.Now()
	if _, err := st.Open(ctx, support.New{Email: "not-an-email", Topic: "payments", Subject: "x", Body: "y"}, now); err != support.ErrBadInput {
		t.Fatalf("bad email: %v", err)
	}
	r, err := st.Open(ctx, support.New{Email: "Ada@Support-Test.example", Name: "Ada", Topic: "payments", Subject: "Charged twice", Body: "My card was charged twice for Red Earth."}, now)
	if err != nil || r.ID == 0 || len(r.Token) < 24 || r.Email != "ada@support-test.example" {
		t.Fatalf("open = %+v %v", r, err)
	}
	var mails int
	p.QueryRow(ctx, `SELECT count(*) FROM mail_outbox WHERE kind IN ('support_received', 'support_new') AND to_email LIKE '%@support-test.example'`).Scan(&mails)
	if mails != 2 {
		t.Fatalf("mails = %d", mails)
	}
	open, err := st.Desk(ctx, "open")
	if err != nil || len(open) == 0 || open[len(open)-1].Last == "" {
		t.Fatalf("desk = %+v %v", open, err)
	}
	a, err := st.Answer(ctx, r.ID, "Staff@E-Cinema.net", "Sorry about that. We refunded the second charge today.", false, now.Add(time.Minute))
	if err != nil || a.Status != "answered" || len(a.Messages) != 2 || !a.Messages[1].Staff || a.Assignee != "staff@e-cinema.net" {
		t.Fatalf("answer = %+v %v", a, err)
	}
	got, err := st.Reply(ctx, r.Token, "Thank you, I see it now.", now.Add(2*time.Minute))
	if err != nil || got.Status != "open" || len(got.Messages) != 3 || got.Messages[2].Staff || !got.UpdatedAt.After(now) {
		t.Fatalf("reply = %+v %v", got, err)
	}
	if _, err := st.ByToken(ctx, "nope-nope-nope-nope-nope-nope"); err != support.ErrNotFound {
		t.Fatalf("bad token: %v", err)
	}
	if c, err := st.Answer(ctx, r.ID, "staff@e-cinema.net", "", true, now.Add(3*time.Minute)); err != nil || c.Status != "closed" || len(c.Messages) != 3 {
		t.Fatalf("close = %+v %v", c, err)
	}
	counts, _, err := st.Counts(ctx, now)
	if err != nil || counts["closed"] < 1 {
		t.Fatalf("counts = %v %v", counts, err)
	}
	for i := 0; i < 4; i++ {
		st.Open(ctx, support.New{Email: "ada@support-test.example", Topic: "other", Subject: "s", Body: "b"}, now)
	}
	if _, err := st.Open(ctx, support.New{Email: "ada@support-test.example", Topic: "other", Subject: "s", Body: "b"}, now); err != support.ErrTooMany {
		t.Fatalf("sixth request: %v", err)
	}
}
