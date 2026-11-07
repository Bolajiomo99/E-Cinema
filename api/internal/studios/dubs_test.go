package studios_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/Bolajiomo99/E-Cinema/api/internal/studios"
)

func TestDubs(t *testing.T) {
	p := pool(t)
	ctx := context.Background()
	st := studios.Store{DB: p}
	const name, email = "Test Dub Pictures", "dub-owner@example.com"
	clean := func() { p.Exec(ctx, `DELETE FROM studios WHERE name = $1`, name) }
	clean()
	t.Cleanup(clean)
	owner := account(t, p, email, "Ada Obi", "NG")
	viewer := account(t, p, "dub-viewer@example.com", "Ife Ola", "NG")
	p.Exec(ctx, `INSERT INTO studios (name, slug, status, payout_email, verified_at) VALUES ($1, 'test-dub-pictures', 'verified', 'x@example.com', now())`, name)
	p.Exec(ctx, `INSERT INTO studio_members (studio, email, account_id, role) VALUES ($1, $2, $3, 'owner'), ($1, 'dub-viewer@example.com', $4, 'viewer')`, name, email, owner, viewer)
	u, _ := st.CreateUpload(ctx, owner, email, "Blade of Kumo")

	if _, err := st.StartDub(ctx, owner, email, u.ID, "ha"); err == nil || !strings.Contains(err.Error(), "subtitle") {
		t.Fatalf("no subtitles: %v", err)
	}
	f, _ := st.AddFile(ctx, owner, email, u.ID, "Kumo_EN.srt", 100)
	done := "uploaded"
	st.UpdateFile(ctx, owner, email, u.ID, f.ID, studios.FileUpdate{Status: &done})
	if _, err := st.StartDub(ctx, viewer, "dub-viewer@example.com", u.ID, "ha"); !errors.Is(err, studios.ErrForbidden) {
		t.Fatalf("viewer starts: %v", err)
	}
	if _, err := st.StartDub(ctx, owner, email, u.ID, "Hausa"); !errors.Is(err, studios.ErrBadInput) {
		t.Fatalf("bad lang: %v", err)
	}
	d, err := st.StartDub(ctx, owner, email, u.ID, "ha")
	if err != nil || d.Status != "translating" {
		t.Fatalf("start: %+v %v", d, err)
	}
	jobs, _ := st.DubWork(ctx)
	found := false
	for _, j := range jobs {
		found = found || (j.Upload == u.ID && j.Lang == "ha" && len(j.Files) == 1)
	}
	if !found {
		t.Fatalf("work list: %+v", jobs)
	}
	if _, err := st.EditLine(ctx, owner, email, u.ID, "ha", 0, "x", false); !errors.Is(err, studios.ErrDubBusy) {
		t.Fatalf("edit while translating: %v", err)
	}
	lines := []studios.DubLine{
		{StartMs: 1000, EndMs: 2000, Speaker: "KENJI", Source: "I'm not done yet.", Text: "Ban gama ba tukuna."},
		{StartMs: 3000, EndMs: 4000, Speaker: "KENJI", Source: "This sword was my father's.", Text: "Wannan takobin na mahaifina ne.", Flag: "Tone sounds too formal"},
	}
	if err := st.SetDubLines(ctx, u.ID, "ha", lines); err != nil {
		t.Fatal(err)
	}
	d, got, _ := st.DubLines(ctx, viewer, "dub-viewer@example.com", u.ID, "ha")
	if d.Status != "review" || d.Lines != 2 || d.Flagged != 1 || len(got) != 2 || got[1].Flag == "" {
		t.Fatalf("after translate: %+v %+v", d, got)
	}
	if _, err := st.Approve(ctx, owner, email, u.ID, "ha"); !errors.Is(err, studios.ErrNotReady) {
		t.Fatalf("approve early: %v", err)
	}
	if _, err := st.Voice(ctx, owner, email, u.ID, "ha"); err != nil {
		t.Fatal(err)
	}
	if err := st.SetLineAudio(ctx, u.ID, "ha", 0, "Ban gama ba tukuna.", "elsewhere/x.mp3"); !errors.Is(err, studios.ErrBadInput) {
		t.Fatalf("audio outside prefix: %v", err)
	}
	for i, l := range lines {
		if err := st.SetLineAudio(ctx, u.ID, "ha", i, l.Text, "studio-dubs/"+u.ID+"/ha/"+l.Speaker+".mp3"); err != nil {
			t.Fatal(err)
		}
	}
	// Audio for an outdated text is refused.
	if err := st.SetLineAudio(ctx, u.ID, "ha", 0, "old text", "studio-dubs/"+u.ID+"/ha/old.mp3"); !errors.Is(err, studios.ErrNotFound) {
		t.Fatalf("stale audio: %v", err)
	}
	st.FinishDub(ctx, u.ID, "ha", "")
	if _, err := st.Approve(ctx, owner, email, u.ID, "ha"); !errors.Is(err, studios.ErrNotReady) {
		t.Fatalf("approve with a flag: %v", err)
	}
	// Clearing the flag without changing the text keeps the voice.
	l, err := st.EditLine(ctx, owner, email, u.ID, "ha", 1, lines[1].Text, true)
	if err != nil || l.Flag != "" || l.AudioKey == "" {
		t.Fatalf("clear flag: %+v %v", l, err)
	}
	a, err := st.Approve(ctx, owner, email, u.ID, "ha")
	if err != nil || a.Status != "approved" || a.ApprovedAt == nil {
		t.Fatalf("approve: %+v %v", a, err)
	}
	sid, langs, _ := st.ApprovedDubs(ctx, u.ID)
	if sid != "" || len(langs) != 1 || langs[0] != "ha" {
		t.Fatalf("approved list: %q %v", sid, langs)
	}
	// Changing a line takes the voice away and sends the language back to review.
	l, _ = st.EditLine(ctx, owner, email, u.ID, "ha", 1, "Takobin mahaifina ne.", false)
	d, _, _ = st.DubLines(ctx, owner, email, u.ID, "ha")
	if l.AudioKey != "" || d.Status != "review" || d.Voiced != 1 {
		t.Fatalf("edit after approve: %+v %+v", l, d)
	}
	// A failed voicing run returns to review with the reason.
	st.Voice(ctx, owner, email, u.ID, "ha")
	st.FinishDub(ctx, u.ID, "ha", "ElevenLabs quota reached")
	d, _, _ = st.DubLines(ctx, owner, email, u.ID, "ha")
	if d.Status != "review" || d.Error == "" {
		t.Fatalf("voice failure: %+v", d)
	}
	// With "AI dub approval" off, a clean voicing run goes live by itself.
	if _, err := st.SetDubReview(ctx, viewer, "dub-viewer@example.com", false); !errors.Is(err, studios.ErrForbidden) {
		t.Fatalf("viewer switched dub review: %v", err)
	}
	if s, err := st.SetDubReview(ctx, owner, email, false); err != nil || s.DubReview {
		t.Fatalf("switch off: %+v %v", s, err)
	}
	st.Voice(ctx, owner, email, u.ID, "ha")
	st.SetLineAudio(ctx, u.ID, "ha", 1, "Takobin mahaifina ne.", "studio-dubs/"+u.ID+"/ha/b.mp3")
	if ok, err := st.FinishDub(ctx, u.ID, "ha", ""); err != nil || !ok {
		t.Fatalf("auto approve: %v %v", ok, err)
	}
	if d, _, _ = st.DubLines(ctx, owner, email, u.ID, "ha"); d.Status != "approved" {
		t.Fatalf("after auto approve: %+v", d)
	}
	if ok, _ := st.FinishDub(ctx, u.ID, "ha", ""); ok {
		t.Fatal("finish on an approved language approved again")
	}
	keys, err := st.RemoveDub(ctx, owner, email, u.ID, "ha")
	if err != nil || len(keys) != 2 {
		t.Fatalf("remove: %v %v", keys, err)
	}
}
