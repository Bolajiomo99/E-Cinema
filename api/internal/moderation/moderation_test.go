package moderation_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/db"
	"github.com/Bolajiomo99/E-Cinema/api/internal/moderation"
)

func TestQueueFlagReview(t *testing.T) {
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
		p.Exec(ctx, `DELETE FROM auto_flags WHERE body LIKE 'modtest %'`)
		p.Exec(ctx, `DELETE FROM room_messages WHERE showtime_id = 'mod-test'`)
		p.Exec(ctx, `DELETE FROM posts WHERE body LIKE 'modtest %'`)
	}
	clean()
	t.Cleanup(clean)
	p.Exec(ctx, `INSERT INTO showtimes VALUES ('mod-test', 'Mod Film', 'S', now() + interval '1 hour', 90, 10, 500, 'USD') ON CONFLICT (id) DO NOTHING`)
	var who string
	if err := p.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash) VALUES ('mod-test@example.com', 'T', '!')
	  ON CONFLICT (email) DO UPDATE SET name = 'T' RETURNING id`).Scan(&who); err != nil {
		t.Fatal(err)
	}
	st := moderation.Store{DB: p}
	// Everything already in the database is behind the cursor.
	if _, upto, err := st.Queue(ctx); err != nil {
		t.Fatal(err)
	} else if _, err := st.Flag(ctx, nil, upto); err != nil {
		t.Fatal(err)
	}

	var nice, nasty, sad, post, comment int64
	ins := func(body string) int64 {
		var id int64
		if err := p.QueryRow(ctx, `INSERT INTO room_messages (showtime_id, account_id, name, body) VALUES ('mod-test', $1, 'T', $2) RETURNING id`, who, body).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	nice, nasty, sad = ins("modtest what a scene"), ins("modtest you are trash"), ins("modtest i want to end it")
	if err := p.QueryRow(ctx, `INSERT INTO posts (author_id, kind, body) VALUES ($1, 'text', 'modtest free film link') RETURNING id`, who).Scan(&post); err != nil {
		t.Fatal(err)
	}
	if err := p.QueryRow(ctx, `INSERT INTO post_comments (post_id, author_id, body) VALUES ($1, $2, 'modtest buy followers') RETURNING id`, post, who).Scan(&comment); err != nil {
		t.Fatal(err)
	}
	p.Exec(ctx, `UPDATE posts SET comments = 1 WHERE id = $1`, post)

	items, upto, err := st.Queue(ctx)
	if err != nil || len(items) != 5 || upto["room"] != sad || upto["post"] != post || upto["comment"] != comment {
		t.Fatalf("queue = %+v %v %v", items, upto, err)
	}
	if items[0].Place != "Mod Film" {
		t.Fatalf("place = %q", items[0].Place)
	}
	if _, err := st.Flag(ctx, []moderation.Verdict{{Source: "room", ID: nice, Label: "made-up", Pct: 99}}, upto); err == nil {
		t.Fatal("unknown label accepted")
	}
	hidden, err := st.Flag(ctx, []moderation.Verdict{
		{Source: "room", ID: nice, Label: "abusive", Pct: 30},    // too unsure: ignored
		{Source: "room", ID: nasty, Label: "abusive", Pct: 95},   // hidden
		{Source: "room", ID: sad, Label: "selfharm", Pct: 97},    // never hidden, a person looks
		{Source: "post", ID: post, Label: "piracy", Pct: 70},     // listed, not hidden
		{Source: "comment", ID: comment, Label: "spam", Pct: 90}, // hidden
	}, upto)
	if err != nil || len(hidden) != 1 || hidden[0].ID != nasty || hidden[0].Showtime != "mod-test" {
		t.Fatalf("hidden = %+v %v", hidden, err)
	}
	var h1, h2 bool
	var comments int
	p.QueryRow(ctx, `SELECT (SELECT hidden FROM room_messages WHERE id = $1), (SELECT hidden FROM room_messages WHERE id = $2), (SELECT comments FROM posts WHERE id = $3)`, nasty, sad, post).Scan(&h1, &h2, &comments)
	if !h1 || h2 || comments != 0 {
		t.Fatalf("nasty hidden %v, sad hidden %v, comments %d", h1, h2, comments)
	}
	if again, _, _ := st.Queue(ctx); len(again) != 0 {
		t.Fatalf("read twice: %+v", again)
	}
	open, today, err := st.Open(ctx, time.Now().Add(-time.Hour))
	if err != nil || today < 4 || len(open) < 4 || !open[0].Hidden {
		t.Fatalf("open = %+v %d %v", open, today, err)
	}

	// A person puts the comment back and removes the post.
	if _, err := st.Review(ctx, "comment", comment, false, "ceo@e-cinema.net"); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Review(ctx, "post", post, true, "ceo@e-cinema.net"); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Review(ctx, "post", post, true, "ceo@e-cinema.net"); err != moderation.ErrNotFound {
		t.Fatalf("settled twice: %v", err)
	}
	var gone bool
	p.QueryRow(ctx, `SELECT (SELECT deleted_at IS NOT NULL FROM posts WHERE id = $1), (SELECT comments FROM posts WHERE id = $1)`, post).Scan(&gone, &comments)
	if !gone || comments != 1 {
		t.Fatalf("post gone %v, comments %d", gone, comments)
	}
	if sid, err := st.Review(ctx, "room", sad, true, "coo@e-cinema.net"); err != nil || sid != "mod-test" {
		t.Fatalf("review room = %q %v", sid, err)
	}
}
