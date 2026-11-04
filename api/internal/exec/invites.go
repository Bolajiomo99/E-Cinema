package exec

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Executive invites (Figma 99:1696). The CEO's grant makes a pending executive and a one-time
// link that works for 48 hours. The invited person signs in with the invited address, types the
// code sent to that inbox, passes the face check and adds a passkey; only then does access open.

const (
	InviteFor     = 48 * time.Hour
	inviteCodeFor = 10 * time.Minute
	inviteCodeGap = time.Minute
	inviteCodeMax = 5
)

var (
	ErrInviteGone  = errors.New("this invite link has expired or was already used; ask the CEO to send a new one")
	ErrWrongPerson = fmt.Errorf("%w: sign in with the address the invite was sent to", ErrForbidden)
)

type Invite struct {
	Email          string     `json:"email"`
	Name           string     `json:"name"`
	Role           string     `json:"role"`
	By             string     `json:"by"`
	ExpiresAt      time.Time  `json:"expiresAt"`
	Gone           bool       `json:"gone"` // expired, used, or access removed
	EmailConfirmed bool       `json:"emailConfirmed"`
	CodeSentAt     *time.Time `json:"codeSentAt"`
}

func hashToken(t string) []byte { h := sha256.Sum256([]byte(t)); return h[:] }

// NewInvite replaces any open invite for a pending executive and returns the new link token.
// Only the CEO can send one, and only to someone who has not finished joining.
func (st Store) NewInvite(ctx context.Context, ceoEmail, target, byName string, now time.Time) (string, error) {
	if !st.ceo(ceoEmail) {
		return "", ErrForbidden
	}
	target = strings.ToLower(strings.TrimSpace(target))
	var pending bool
	if err := st.DB.QueryRow(ctx, `SELECT pending FROM executives WHERE email = $1`, target).Scan(&pending); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrNotFound
		}
		return "", err
	}
	if !pending {
		return "", nil // already joined: the email is a plain notice, no link needed
	}
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	tok := base64.RawURLEncoding.EncodeToString(b)
	tx, err := st.DB.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM exec_invites WHERE email = $1 AND used_at IS NULL`, target); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO exec_invites (token_hash, email, by_name, expires_at) VALUES ($1, $2, $3, $4)`,
		hashToken(tok), target, strings.TrimSpace(byName), now.Add(InviteFor)); err != nil {
		return "", err
	}
	return tok, tx.Commit(ctx)
}

// LookInvite is public: the page shows who invited whom before anyone signs in.
func (st Store) LookInvite(ctx context.Context, token string, now time.Time) (Invite, error) {
	var in Invite
	var used *time.Time
	var pending *bool
	err := st.DB.QueryRow(ctx, `SELECT i.email, coalesce(e.name, ''), coalesce(e.role, ''), i.by_name, i.expires_at, i.used_at, e.pending,
	    i.email_confirmed_at IS NOT NULL, i.code_sent_at
	  FROM exec_invites i LEFT JOIN executives e ON e.email = i.email WHERE i.token_hash = $1`, hashToken(token)).
		Scan(&in.Email, &in.Name, &in.Role, &in.By, &in.ExpiresAt, &used, &pending, &in.EmailConfirmed, &in.CodeSentAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return in, ErrNotFound
	}
	in.Gone = used != nil || !now.Before(in.ExpiresAt) || pending == nil || !*pending
	return in, err
}

func (st Store) openInvite(ctx context.Context, token, email string, now time.Time) (Invite, error) {
	in, err := st.LookInvite(ctx, token, now)
	if err != nil {
		return in, err
	}
	if in.Gone {
		return in, ErrInviteGone
	}
	if !strings.EqualFold(in.Email, email) {
		return in, ErrWrongPerson
	}
	return in, nil
}

// InviteCode makes a six-digit code for the invited inbox. The caller emails it.
func (st Store) InviteCode(ctx context.Context, token, email string, now time.Time) (string, error) {
	in, err := st.openInvite(ctx, token, email, now)
	if err != nil {
		return "", err
	}
	if in.EmailConfirmed {
		return "", fmt.Errorf("%w: your email is already confirmed", ErrBadInput)
	}
	if in.CodeSentAt != nil && now.Sub(*in.CodeSentAt) < inviteCodeGap {
		return "", fmt.Errorf("%w: wait a minute before asking for another code", ErrBadInput)
	}
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return "", err
	}
	code := fmt.Sprintf("%06d", n.Int64())
	_, err = st.DB.Exec(ctx, `UPDATE exec_invites SET code_hash = $2, code_sent_at = $3, code_tries = 0 WHERE token_hash = $1`, hashToken(token), hashToken(code), now)
	return code, err
}

// ConfirmInviteCode checks the code; five wrong tries end the code.
func (st Store) ConfirmInviteCode(ctx context.Context, token, email, code string, now time.Time) error {
	if _, err := st.openInvite(ctx, token, email, now); err != nil {
		return err
	}
	var want []byte
	var sent *time.Time
	var tries int
	if err := st.DB.QueryRow(ctx, `SELECT code_hash, code_sent_at, code_tries FROM exec_invites WHERE token_hash = $1`, hashToken(token)).Scan(&want, &sent, &tries); err != nil {
		return err
	}
	if want == nil || sent == nil || now.Sub(*sent) > inviteCodeFor || tries >= inviteCodeMax {
		return fmt.Errorf("%w: that code has expired; send a new one", ErrBadInput)
	}
	if subtle.ConstantTimeCompare(want, hashToken(strings.TrimSpace(code))) != 1 {
		_, err := st.DB.Exec(ctx, `UPDATE exec_invites SET code_tries = code_tries + 1 WHERE token_hash = $1`, hashToken(token))
		if err != nil {
			return err
		}
		return fmt.Errorf("%w: that code is not right", ErrBadInput)
	}
	_, err := st.DB.Exec(ctx, `UPDATE exec_invites SET email_confirmed_at = $2, code_hash = NULL WHERE token_hash = $1`, hashToken(token), now)
	return err
}

// AcceptInvite opens executive access once every step is done. The link then stops working.
func (st Store) AcceptInvite(ctx context.Context, token, email, accountID string, now time.Time) error {
	in, err := st.openInvite(ctx, token, email, now)
	if err != nil {
		return err
	}
	var face, key bool
	if err := st.DB.QueryRow(ctx, `SELECT face_verified_at IS NOT NULL, EXISTS (SELECT 1 FROM passkeys WHERE account_id = $1) FROM accounts WHERE id = $1`, accountID).Scan(&face, &key); err != nil {
		return err
	}
	switch {
	case !in.EmailConfirmed:
		return fmt.Errorf("%w: confirm your email first", ErrBadInput)
	case !face:
		return fmt.Errorf("%w: finish the face check first", ErrBadInput)
	case !key:
		return fmt.Errorf("%w: create a passkey first", ErrBadInput)
	}
	tx, err := st.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `UPDATE exec_invites SET used_at = $2 WHERE token_hash = $1 AND used_at IS NULL`, hashToken(token), now)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrInviteGone
	}
	if _, err := tx.Exec(ctx, `UPDATE executives SET pending = false WHERE email = $1`, in.Email); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
