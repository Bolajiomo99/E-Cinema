package studios

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Studio API keys (Figma 39:1073 "API keys"): read-only access to the studio's own films,
// sales and payouts. A key is shown once; only its SHA-256 is stored.

// MaxKeys caps the live keys one studio can hold.
const MaxKeys = 5

var (
	ErrBadKey      = errors.New("This API key is not valid or was revoked")
	ErrNoFilm      = errors.New("No film with that showtime id belongs to this studio")
	ErrTooManyKeys = fmt.Errorf("a studio can have up to %d live API keys", MaxKeys)
	keyRe          = regexp.MustCompile(`^ecs_[0-9a-f]{40}$`)
)

type APIKey struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	Prefix     string     `json:"prefix"` // the first characters, to tell keys apart
	Key        string     `json:"key,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
	LastUsedAt *time.Time `json:"lastUsedAt"`
}

func keyHash(k string) string {
	h := sha256.Sum256([]byte(k))
	return hex.EncodeToString(h[:])
}

func scanKey(r pgx.CollectableRow) (APIKey, error) {
	var k APIKey
	err := r.Scan(&k.ID, &k.Name, &k.Prefix, &k.CreatedAt, &k.LastUsedAt)
	return k, err
}

// Keys lists the studio's live keys (owners and admins only).
func (st Store) Keys(ctx context.Context, acct, email string) ([]APIKey, error) {
	s, err := st.hookStudio(ctx, acct, email)
	if err != nil {
		return nil, err
	}
	rows, err := st.DB.Query(ctx, `SELECT id, name, prefix, created_at, last_used_at FROM studio_api_keys WHERE studio = $1 AND revoked_at IS NULL ORDER BY created_at`, s.Name)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanKey)
}

// AddKey makes a key and returns it in full, this once.
func (st Store) AddKey(ctx context.Context, acct, email, name string) (APIKey, error) {
	s, err := st.hookStudio(ctx, acct, email)
	if err != nil {
		return APIKey{}, err
	}
	name = clip(name, 60)
	if name == "" {
		return APIKey{}, ErrBadInput
	}
	var n int
	if err := st.DB.QueryRow(ctx, `SELECT count(*) FROM studio_api_keys WHERE studio = $1 AND revoked_at IS NULL`, s.Name).Scan(&n); err != nil {
		return APIKey{}, err
	}
	if n >= MaxKeys {
		return APIKey{}, ErrTooManyKeys
	}
	b := make([]byte, 20)
	rand.Read(b)
	key := "ecs_" + hex.EncodeToString(b)
	rows, err := st.DB.Query(ctx, `INSERT INTO studio_api_keys (studio, name, prefix, hash, created_by) VALUES ($1, $2, $3, $4, $5)
	  RETURNING id, name, prefix, created_at, last_used_at`, s.Name, name, key[:10], keyHash(key), acct)
	if err != nil {
		return APIKey{}, err
	}
	k, err := pgx.CollectExactlyOneRow(rows, scanKey)
	k.Key = key
	return k, err
}

// RevokeKey stops a key working at once.
func (st Store) RevokeKey(ctx context.Context, acct, email, id string) error {
	s, err := st.hookStudio(ctx, acct, email)
	if err != nil {
		return err
	}
	if !uuidRe.MatchString(id) {
		return ErrNotFound
	}
	tag, err := st.DB.Exec(ctx, `UPDATE studio_api_keys SET revoked_at = now() WHERE id = $1 AND studio = $2 AND revoked_at IS NULL`, id, s.Name)
	if err == nil && tag.RowsAffected() == 0 {
		err = ErrNotFound
	}
	return err
}

// keyStudio finds the verified studio a live key belongs to.
func (st Store) keyStudio(ctx context.Context, key string, now time.Time) (name string, share int, err error) {
	key = strings.TrimSpace(key)
	if !keyRe.MatchString(key) {
		return "", 0, ErrBadKey
	}
	var id string
	err = st.DB.QueryRow(ctx, `SELECT k.id, s.name, s.share_bps FROM studio_api_keys k JOIN studios s ON s.name = k.studio
	  WHERE k.hash = $1 AND k.revoked_at IS NULL AND s.status = 'verified'`, keyHash(key)).Scan(&id, &name, &share)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", 0, ErrBadKey
	}
	if err != nil {
		return "", 0, err
	}
	_, err = st.DB.Exec(ctx, `UPDATE studio_api_keys SET last_used_at = $2 WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < $2::timestamptz - interval '1 minute')`, id, now)
	return name, share, err
}

// APIFilms is GET /films for a key: every screening of the studio, newest first.
func (st Store) APIFilms(ctx context.Context, key string, now time.Time) ([]Film, error) {
	name, share, err := st.keyStudio(ctx, key, now)
	if err != nil {
		return nil, err
	}
	return st.films(ctx, name, share)
}

// APISales is GET /films/{showtime}/sales for a key.
func (st Store) APISales(ctx context.Context, key, showtimeID string, now time.Time) (Sales, error) {
	name, _, err := st.keyStudio(ctx, key, now)
	if err != nil {
		return Sales{}, err
	}
	var ok bool
	if err := st.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM showtimes WHERE id = $1 AND studio = $2)`, showtimeID, name).Scan(&ok); err != nil {
		return Sales{}, err
	}
	if !ok {
		return Sales{}, ErrNoFilm
	}
	return st.salesFor(ctx, showtimeID, now)
}

// APIPayouts is GET /payouts for a key.
func (st Store) APIPayouts(ctx context.Context, key string, now time.Time) ([]PayoutRow, error) {
	name, _, err := st.keyStudio(ctx, key, now)
	if err != nil {
		return nil, err
	}
	return st.payoutsOf(ctx, name)
}
