package exec_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/db"
	"github.com/Bolajiomo99/E-Cinema/api/internal/exec"
)

func TestRolesAndCommand(t *testing.T) {
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
	p.Exec(ctx, `DELETE FROM executives WHERE email LIKE 'ex-%@example.com'`)
	t.Cleanup(func() { p.Exec(ctx, `DELETE FROM executives WHERE email LIKE 'ex-%@example.com'`) })
	p.Exec(ctx, `INSERT INTO executives (email, role) VALUES ('ex-cfo@example.com', 'cfo'), ('ex-inv@example.com', 'investor')`)
	st := exec.Store{DB: p, CEOs: []string{"ex-ceo@example.com"}}

	for email, want := range map[string]string{"EX-CEO@example.com": "ceo", "ex-cfo@example.com": "cfo", "ex-inv@example.com": "investor", "ex-nobody@example.com": ""} {
		if got, err := st.Role(ctx, email); err != nil || got != want {
			t.Fatalf("role %s = %q %v, want %q", email, got, err, want)
		}
	}
	c, err := st.Command(ctx, "ex-ceo@example.com", time.Now())
	if err != nil || len(c.Months) != 12 {
		t.Fatalf("ceo command: %+v %v", c, err)
	}
	if _, err := st.Command(ctx, "ex-cfo@example.com", time.Now()); err != nil {
		t.Fatalf("cfo: %v", err)
	}
	for _, e := range []string{"ex-inv@example.com", "ex-nobody@example.com"} {
		if _, err := st.Command(ctx, e, time.Now()); !errors.Is(err, exec.ErrForbidden) {
			t.Fatalf("%s should be forbidden, got %v", e, err)
		}
	}
}

func TestAccess(t *testing.T) {
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
	clean := func() { p.Exec(ctx, `DELETE FROM executives WHERE email LIKE 'ax-%@example.com'`) }
	clean()
	t.Cleanup(clean)
	st := exec.Store{DB: p, CEOs: []string{"ax-ceo@example.com"}}
	now := time.Now()
	if _, err := st.Grant(ctx, "ax-cfo@example.com", "", exec.Grant{Email: "ax-x@example.com", Role: "investor"}, now); !errors.Is(err, exec.ErrForbidden) {
		t.Fatalf("non-CEO grant: %v", err)
	}
	for _, g := range []exec.Grant{{Email: "nope", Role: "cfo"}, {Email: "ax-ceo@example.com", Role: "cfo"}, {Email: "ax-a@example.com", Role: "ceo"}, {Email: "ax-a@example.com", Role: "boss"}, {Email: "ax-a@example.com", Role: "cfo", ExpiresOn: "2001-01-01"}} {
		if _, err := st.Grant(ctx, "ax-ceo@example.com", "", g, now); !errors.Is(err, exec.ErrBadInput) {
			t.Fatalf("grant %+v: %v", g, err)
		}
	}
	added, err := st.Grant(ctx, "AX-CEO@example.com", "", exec.Grant{Email: " AX-Inv@Example.com ", Name: "Ngozi Eze", Org: "Helios Fund", Role: "investor", Scopes: []string{"growth", "revenue", "growth", "bogus"}, ExpiresOn: now.AddDate(0, 1, 0).Format("2006-01-02")}, now)
	if err != nil || !added {
		t.Fatalf("grant: %v %v", added, err)
	}
	if added, err = st.Grant(ctx, "ax-ceo@example.com", "", exec.Grant{Email: "ax-inv@example.com", Role: "stakeholder"}, now); err != nil || added {
		t.Fatalf("change: %v %v", added, err)
	}
	ppl, err := st.People(ctx, "ax-ceo@example.com")
	if err != nil || len(ppl) < 2 || ppl[0].Role != "ceo" {
		t.Fatalf("people: %+v %v", ppl, err)
	}
	var got *exec.Person
	for i := range ppl {
		if ppl[i].Email == "ax-inv@example.com" {
			got = &ppl[i]
		}
	}
	if got == nil || got.Role != "stakeholder" || len(got.Scopes) != 0 || got.ExpiresOn != "" {
		t.Fatalf("changed person: %+v", got)
	}
	if r, _ := st.Role(ctx, "ax-inv@example.com"); r != "stakeholder" {
		t.Fatalf("role %q", r)
	}
	// Expired access stops at once.
	p.Exec(ctx, `UPDATE executives SET expires_on = current_date - 2 WHERE email = 'ax-inv@example.com'`)
	if r, _ := st.Role(ctx, "ax-inv@example.com"); r != "" {
		t.Fatalf("expired role %q", r)
	}
	if err := st.Revoke(ctx, "ax-ceo@example.com", "ax-inv@example.com"); err != nil {
		t.Fatal(err)
	}
	if err := st.Revoke(ctx, "ax-ceo@example.com", "ax-inv@example.com"); !errors.Is(err, exec.ErrNotFound) {
		t.Fatalf("second revoke: %v", err)
	}
}
