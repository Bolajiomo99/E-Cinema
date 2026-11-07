package accounts

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Five failed face checks within ten minutes lock the account (email 33, Figma 127:215).
const (
	FaceFailLimit  = 5
	FaceFailWindow = 10 * time.Minute
	unlockCodeFor  = 24 * time.Hour
	unlockTokenFor = 30 * time.Minute
)

// FaceLock is returned when a failed check locks the account: the code goes in the email.
type FaceLock struct {
	Email string
	Name  string
	Code  string
	Place string
}

// RecordFaceFailure stores one failed face check attempt (an attempt counts once, however
// often its result is read). When it is the fifth inside the window, every device is signed
// out, sign-in is refused and an unlock code is made; the lock is returned for the email.
func (s Store) RecordFaceFailure(ctx context.Context, accountID, attempt, device, place string) (*FaceLock, error) {
	attempt = strings.TrimSpace(attempt)
	if attempt == "" {
		return nil, nil
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var lock FaceLock
	var already bool
	if err := tx.QueryRow(ctx, `SELECT email, name, face_locked_at IS NOT NULL FROM accounts WHERE id = $1 FOR UPDATE`, accountID).
		Scan(&lock.Email, &lock.Name, &already); err != nil {
		return nil, err
	}
	tag, err := tx.Exec(ctx, `INSERT INTO face_failures (account_id, attempt, device, place) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
		accountID, attempt, cleanDevice(device), strings.TrimSpace(place))
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 || already {
		return nil, tx.Commit(ctx)
	}
	var n int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM face_failures WHERE account_id = $1 AND at > now() - $2::interval`,
		accountID, FaceFailWindow.String()).Scan(&n); err != nil {
		return nil, err
	}
	if n < FaceFailLimit {
		return nil, tx.Commit(ctx)
	}
	if _, err := tx.Exec(ctx, `UPDATE accounts SET face_locked_at = now() WHERE id = $1`, accountID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `UPDATE account_sessions SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL`, accountID); err != nil {
		return nil, err
	}
	if lock.Code, err = s.newUnlockCode(ctx, tx, accountID); err != nil {
		return nil, err
	}
	lock.Place = strings.TrimSpace(place)
	return &lock, tx.Commit(ctx)
}

func (s Store) newUnlockCode(ctx context.Context, tx pgx.Tx, accountID string) (string, error) {
	code, err := sixDigits()
	if err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `UPDATE auth_codes SET used_at = now() WHERE account_id = $1 AND purpose = 'unlock' AND used_at IS NULL`, accountID); err != nil {
		return "", err
	}
	_, err = tx.Exec(ctx, `INSERT INTO auth_codes (account_id, purpose, code_hash, expires_at) VALUES ($1, 'unlock', $2, now() + $3::interval)`,
		accountID, hashToken(accountID+":"+code), unlockCodeFor.String())
	return code, err
}

// ResendUnlockCode makes a new unlock code for a locked account. Callers answer the same way
// whether or not the email belongs to a locked account.
func (s Store) ResendUnlockCode(ctx context.Context, email string) (*FaceLock, error) {
	e, ok := normEmail(email)
	if !ok {
		return nil, ErrBadInput
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var id string
	lock := FaceLock{}
	err = tx.QueryRow(ctx, `SELECT id, email, name FROM accounts WHERE email = $1 AND face_locked_at IS NOT NULL FOR UPDATE`, e).Scan(&id, &lock.Email, &lock.Name)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var recent int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM auth_codes WHERE account_id = $1 AND purpose = 'unlock' AND created_at > now() - $2::interval`,
		id, CodeResendGap.String()).Scan(&recent); err != nil {
		return nil, err
	}
	if recent > 0 {
		return nil, ErrTooSoon
	}
	if lock.Code, err = s.newUnlockCode(ctx, tx, id); err != nil {
		return nil, err
	}
	_ = tx.QueryRow(ctx, `SELECT place FROM face_failures WHERE account_id = $1 ORDER BY at DESC LIMIT 1`, id).Scan(&lock.Place)
	return &lock, tx.Commit(ctx)
}

// StartUnlock swaps a correct unlock code for a short-lived token that allows one new face check.
func (s Store) StartUnlock(ctx context.Context, email, code string) (token, accountID string, err error) {
	e, ok := normEmail(email)
	if !ok {
		return "", "", ErrBadCode
	}
	err = s.DB.QueryRow(ctx, `SELECT id FROM accounts WHERE email = $1 AND face_locked_at IS NOT NULL`, e).Scan(&accountID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", ErrBadCode
	}
	if err != nil {
		return "", "", err
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return "", "", err
	}
	defer tx.Rollback(ctx)
	if err := s.checkCode(ctx, tx, accountID, "unlock", code); err != nil {
		if errors.Is(err, ErrBadCode) || errors.Is(err, ErrPaused) || errors.Is(err, ErrCodeExpired) {
			_ = tx.Commit(ctx)
		}
		return "", "", err
	}
	if token, err = newToken(); err != nil {
		return "", "", err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO auth_codes (account_id, purpose, code_hash, expires_at) VALUES ($1, 'unlock-token', $2, now() + $3::interval)`,
		accountID, hashToken(token), unlockTokenFor.String()); err != nil {
		return "", "", err
	}
	return token, accountID, tx.Commit(ctx)
}

// UnlockAccount resolves an unlock token to its locked account.
func (s Store) UnlockAccount(ctx context.Context, token string) (string, error) {
	var id string
	err := s.DB.QueryRow(ctx, `SELECT c.account_id FROM auth_codes c JOIN accounts a ON a.id = c.account_id
		WHERE c.purpose = 'unlock-token' AND c.code_hash = $1 AND c.used_at IS NULL AND c.expires_at > now() AND a.face_locked_at IS NOT NULL`,
		hashToken(token)).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrBadCode
	}
	return id, err
}

// FinishUnlock lifts the lock once the new face check is approved, and spends the token.
func (s Store) FinishUnlock(ctx context.Context, token string) error {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var id string
	err = tx.QueryRow(ctx, `UPDATE auth_codes SET used_at = now() WHERE purpose = 'unlock-token' AND code_hash = $1 AND used_at IS NULL AND expires_at > now()
		RETURNING account_id`, hashToken(token)).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrBadCode
	}
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE accounts SET face_locked_at = NULL WHERE id = $1`, id); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM face_failures WHERE account_id = $1`, id); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM sign_in_failures WHERE email = (SELECT email FROM accounts WHERE id = $1)`, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
