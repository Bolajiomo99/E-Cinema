package exec_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/db"
	"github.com/Bolajiomo99/E-Cinema/api/internal/exec"
)

func TestRecordErrorGroupsAndAlerts(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := db.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	clean := func() {
		pool.Exec(ctx, `DELETE FROM app_errors`)
		pool.Exec(ctx, `DELETE FROM mail_outbox WHERE kind = 'error_alert'`)
	}
	clean()
	t.Cleanup(clean)
	st := exec.Store{DB: pool, CEOs: []string{"ceo@example.com"}}
	now := time.Date(2026, 11, 9, 12, 0, 0, 0, time.UTC)
	alerts := func() (n int) {
		_ = pool.QueryRow(ctx, `SELECT count(*) FROM mail_outbox WHERE kind = 'error_alert'`).Scan(&n)
		return
	}
	a, err := st.RecordError(ctx, exec.AppError{Source: "browser", Message: "Cannot read id of undefined (row 12)", Stack: "at x (/_next/static/chunks/app.js:1:200)", Path: "/home"}, now)
	if err != nil {
		t.Fatal(err)
	}
	// Same problem with a different number: same group, no second alert within six hours.
	b, err := st.RecordError(ctx, exec.AppError{Source: "browser", Message: "Cannot read id of undefined (row 99)", Stack: "at x (/_next/static/chunks/app.js:1:200)", Path: "/tickets"}, now.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if a.Fingerprint != b.Fingerprint || b.Count != 2 {
		t.Fatalf("not grouped: %s %s count %d", a.Fingerprint, b.Fingerprint, b.Count)
	}
	if n := alerts(); n != 1 {
		t.Fatalf("alerts = %d, want 1", n)
	}
	// Marked fixed, then seen again: reopens and alerts again.
	if err := st.ResolveError(ctx, "ceo@example.com", a.Fingerprint, now.Add(2*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := st.RecordError(ctx, exec.AppError{Source: "browser", Message: "Cannot read id of undefined (row 1)", Stack: "at x (/_next/static/chunks/app.js:1:200)"}, now.Add(3*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if n := alerts(); n != 2 {
		t.Fatalf("alerts after reopen = %d, want 2", n)
	}
	list, err := st.Errors(ctx, "ceo@example.com", now.Add(4*time.Hour))
	if err != nil || len(list) != 1 || list[0].ResolvedAt != nil {
		t.Fatalf("list = %+v, %v", list, err)
	}
	if _, err := st.Errors(ctx, "someone@example.com", now); err == nil {
		t.Fatal("non-executive could read errors")
	}
}
