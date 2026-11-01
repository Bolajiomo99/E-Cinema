package studios_test

import (
	"context"
	"errors"
	"testing"

	"github.com/Bolajiomo99/E-Cinema/api/internal/studios"
)

func TestKindOf(t *testing.T) {
	for _, c := range []struct {
		name   string
		master bool
		want   string
	}{
		{"RedEarth_MASTER.mov", false, "master"},
		{"RedEarth_Trailer.mov", false, "trailer"},
		{"second_cut.mp4", true, "trailer"},
		{"reel1.MXF", true, "master"},
		{"CPL_red.xml", false, "package"},
		{"Stems_5.1.wav", false, "stems"},
		{"Subs_EN.srt", false, "subtitles"},
		{"poster.exe", false, ""},
		{"noext", false, ""},
	} {
		if got := studios.KindOf(c.name, c.master); got != c.want {
			t.Errorf("KindOf(%q, %v) = %q, want %q", c.name, c.master, got, c.want)
		}
	}
}

func TestUploads(t *testing.T) {
	p := pool(t)
	ctx := context.Background()
	st := studios.Store{DB: p}
	clean := func() {
		p.Exec(ctx, `DELETE FROM studios WHERE name LIKE 'Test Upload%'`)
	}
	clean()
	t.Cleanup(clean)
	owner := account(t, p, "up-owner@example.com", "Ada Obi", "NG")
	viewer := account(t, p, "up-viewer@example.com", "Ife Ola", "NG")
	if _, err := p.Exec(ctx, `INSERT INTO studios (name, slug, status, payout_email) VALUES ('Test Upload Pictures', 'test-upload-pictures', 'draft', 'x@example.com')`); err != nil {
		t.Fatal(err)
	}
	p.Exec(ctx, `INSERT INTO studio_members (studio, email, account_id, role) VALUES ('Test Upload Pictures', 'up-owner@example.com', $1, 'owner'), ('Test Upload Pictures', 'up-viewer@example.com', $2, 'viewer')`, owner, viewer)

	if _, err := st.CreateUpload(ctx, owner, "up-owner@example.com", "Red Earth"); !errors.Is(err, studios.ErrNotVerified) {
		t.Fatalf("unverified studio uploads: %v", err)
	}
	p.Exec(ctx, `UPDATE studios SET status = 'verified' WHERE name = 'Test Upload Pictures'`)
	if _, err := st.CreateUpload(ctx, viewer, "up-viewer@example.com", "Red Earth"); !errors.Is(err, studios.ErrForbidden) {
		t.Fatalf("viewer uploads: %v", err)
	}
	if _, err := st.CreateUpload(ctx, owner, "up-owner@example.com", "  "); !errors.Is(err, studios.ErrBadInput) {
		t.Fatalf("empty title: %v", err)
	}
	u, err := st.CreateUpload(ctx, owner, "up-owner@example.com", "Red Earth")
	if err != nil || u.Status != "draft" || len(u.Files) != 0 {
		t.Fatalf("create: %+v %v", u, err)
	}
	if _, err := st.AddFile(ctx, owner, "up-owner@example.com", u.ID, "virus.exe", 10); !errors.Is(err, studios.ErrBadInput) {
		t.Fatalf("bad type: %v", err)
	}
	if _, err := st.AddFile(ctx, owner, "up-owner@example.com", u.ID, "big.mov", studios.MaxFileBytes+1); !errors.Is(err, studios.ErrBadInput) {
		t.Fatalf("too big: %v", err)
	}
	m, err := st.AddFile(ctx, owner, "up-owner@example.com", u.ID, "../RedEarth_MASTER.mov", 1<<40)
	if err != nil || m.Kind != "master" || m.Status != "uploading" || m.Key != "studio-uploads/"+u.ID+"/"+m.ID+".mov" || m.Name != ".._RedEarth_MASTER.mov" {
		t.Fatalf("master: %+v %v", m, err)
	}
	second, err := st.AddFile(ctx, owner, "up-owner@example.com", u.ID, "alt_cut.mov", 100)
	if err != nil || second.Kind != "trailer" {
		t.Fatalf("second video: %+v %v", second, err)
	}
	mp := "mp-123"
	done := "uploaded"
	checks := []studios.Check{{State: "ok", Text: "QuickTime file"}, {State: "soon", Text: "Loudness"}}
	f, err := st.UpdateFile(ctx, owner, "up-owner@example.com", u.ID, m.ID, studios.FileUpdate{MpID: &mp})
	if err != nil || f.MpID != "mp-123" {
		t.Fatalf("mp: %+v %v", f, err)
	}
	if _, err := st.UpdateFile(ctx, owner, "up-owner@example.com", u.ID, m.ID, studios.FileUpdate{MpID: &mp}); !errors.Is(err, studios.ErrBadInput) {
		t.Fatalf("mp id can only be set once: %v", err)
	}
	bad := []studios.Check{{State: "great", Text: "x"}}
	if _, err := st.UpdateFile(ctx, owner, "up-owner@example.com", u.ID, m.ID, studios.FileUpdate{Checks: &bad}); !errors.Is(err, studios.ErrBadInput) {
		t.Fatalf("bad check: %v", err)
	}
	if f, err = st.UpdateFile(ctx, owner, "up-owner@example.com", u.ID, m.ID, studios.FileUpdate{Status: &done, Checks: &checks}); err != nil || f.Status != "uploaded" || len(f.Checks) != 2 {
		t.Fatalf("done: %+v %v", f, err)
	}
	if _, err := st.UpdateFile(ctx, viewer, "up-viewer@example.com", u.ID, m.ID, studios.FileUpdate{Status: &done}); !errors.Is(err, studios.ErrForbidden) {
		t.Fatalf("viewer update: %v", err)
	}
	if got, err := st.File(ctx, viewer, "up-viewer@example.com", u.ID, m.ID, false); err != nil || got.ID != m.ID {
		t.Fatalf("viewer reads: %v", err)
	}
	if err := st.RemoveFile(ctx, owner, "up-owner@example.com", u.ID, second.ID); err != nil {
		t.Fatal(err)
	}
	if u, err = st.RenameUpload(ctx, owner, "up-owner@example.com", u.ID, "Red Earth (2026)"); err != nil || u.Title != "Red Earth (2026)" || len(u.Files) != 1 {
		t.Fatalf("rename: %+v %v", u, err)
	}
	list, err := st.Uploads(ctx, viewer, "up-viewer@example.com")
	if err != nil || len(list) != 1 || len(list[0].Files) != 1 {
		t.Fatalf("list: %+v %v", list, err)
	}
	// Someone from another studio cannot see the draft.
	stranger := account(t, p, "up-stranger@example.com", "X Y", "NG")
	if _, err := st.Upload(ctx, stranger, "up-stranger@example.com", u.ID); !errors.Is(err, studios.ErrNotFound) {
		t.Fatalf("stranger: %v", err)
	}
}
