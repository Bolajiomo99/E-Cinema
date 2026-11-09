package translations_test

import (
	"context"
	"os"
	"testing"

	"github.com/Bolajiomo99/E-Cinema/api/internal/db"
	"github.com/Bolajiomo99/E-Cinema/api/internal/translations"
)

func TestSaveAndLookup(t *testing.T) {
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
	p.Exec(ctx, `DELETE FROM translations WHERE lang = 'xx'`)
	t.Cleanup(func() { p.Exec(ctx, `DELETE FROM translations WHERE lang = 'xx'`) })
	st := translations.Store{DB: p}
	h := translations.Hash("Get a seat")
	// A forged hash is ignored: the key always comes from the English text.
	if _, err := st.Save(ctx, "xx", []translations.Item{{Hash: "00000000000000000000000000000000", Src: "Get a seat", Text: "Gba ìjókòó"}}); err != nil {
		t.Fatal(err)
	}
	got, err := st.Lookup(ctx, "xx", []string{h, "00000000000000000000000000000000", "not-a-hash"})
	if err != nil || got[h] != "Gba ìjókòó" || len(got) != 1 {
		t.Fatalf("lookup = %v %v", got, err)
	}
	if _, err := st.Lookup(ctx, "bad lang!", []string{h}); err == nil {
		t.Fatal("bad language accepted")
	}
}
