// Package translations is the translation memory: English site text and its translation into
// each visitor language, filled by the web app (which asks Claude for strings it has not seen).
package translations

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"regexp"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct{ DB *pgxpool.Pool }

var (
	ErrBadInput = errors.New("bad translation input")
	langRe      = regexp.MustCompile(`^[a-z]{2,3}(-[A-Za-z]{2,4})?$`)
	hashRe      = regexp.MustCompile(`^[0-9a-f]{32}$`)
)

// Hash is the key of an English string.
func Hash(src string) string {
	sum := sha256.Sum256([]byte(src))
	return hex.EncodeToString(sum[:16])
}

type Item struct {
	Hash string `json:"hash"`
	Src  string `json:"src,omitempty"`
	Text string `json:"text"`
}

// Lookup returns the stored translations for the given hashes (missing ones are left out).
func (s Store) Lookup(ctx context.Context, lang string, hashes []string) (map[string]string, error) {
	out := map[string]string{}
	if !langRe.MatchString(lang) || len(hashes) > 2000 {
		return out, ErrBadInput
	}
	keep := make([]string, 0, len(hashes))
	for _, h := range hashes {
		if hashRe.MatchString(h) {
			keep = append(keep, h)
		}
	}
	rows, err := s.DB.Query(ctx, `SELECT src_hash, text FROM translations WHERE lang = $1 AND src_hash = ANY($2)`, lang, keep)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var h, t string
		if err := rows.Scan(&h, &t); err != nil {
			return out, err
		}
		out[h] = t
	}
	return out, rows.Err()
}

// Save stores new translations. The hash is recomputed from the English text, so a caller
// cannot file a translation under someone else's string.
func (s Store) Save(ctx context.Context, lang string, items []Item) (int, error) {
	if !langRe.MatchString(lang) || len(items) > 500 {
		return 0, ErrBadInput
	}
	n := 0
	for _, it := range items {
		if it.Src == "" || it.Text == "" || len(it.Src) > 4000 || len(it.Text) > 8000 {
			continue
		}
		tag, err := s.DB.Exec(ctx, `INSERT INTO translations (lang, src_hash, src, text) VALUES ($1, $2, $3, $4)
		  ON CONFLICT (lang, src_hash) DO UPDATE SET text = EXCLUDED.text, src = EXCLUDED.src`, lang, Hash(it.Src), it.Src, it.Text)
		if err != nil {
			return n, err
		}
		n += int(tag.RowsAffected())
	}
	return n, nil
}
