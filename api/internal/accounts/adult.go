package accounts

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// The adult PIN and per-stage checks behind the 18+ unlock (Figma 28:839).
const (
	PINTries  = 5
	PINPause  = 30 * time.Minute
	GrantFor  = 15 * time.Minute
	pinMinLen = 4
	pinMaxLen = 6
)

var (
	ErrNotAdult  = errors.New("finish the face and ID check in your account first")
	ErrNoPIN     = errors.New("set your adult PIN first")
	ErrBadPIN    = errors.New("that adult PIN is wrong")
	ErrPINPaused = errors.New("too many wrong PINs; adult payments are paused for 30 minutes")
	ErrBadGrant  = errors.New("the adult check expired; enter your PIN and code again")
)

type AdultStatus struct {
	Verified   bool       `json:"verified"`
	VerifiedAt *time.Time `json:"verifiedAt,omitempty"`
	PINSet     bool       `json:"pinSet"`
}

func (s Store) Adult(ctx context.Context, accountID string) (AdultStatus, error) {
	var a AdultStatus
	var id, face *time.Time
	err := s.DB.QueryRow(ctx, `SELECT id_verified_at, face_verified_at, adult_pin_hash IS NOT NULL FROM accounts WHERE id = $1`, accountID).Scan(&id, &face, &a.PINSet)
	if errors.Is(err, pgx.ErrNoRows) {
		return a, ErrNotFound
	}
	if id != nil && face != nil {
		a.Verified = true
		a.VerifiedAt = face
		if id.After(*face) {
			a.VerifiedAt = id
		}
	}
	return a, err
}

func validPIN(pin string) bool {
	if len(pin) < pinMinLen || len(pin) > pinMaxLen {
		return false
	}
	for _, r := range pin {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// SetAdultPIN sets or replaces the PIN. Only verified adults may have one.
func (s Store) SetAdultPIN(ctx context.Context, accountID, pin string) error {
	if !validPIN(pin) {
		return fmt.Errorf("%w: the PIN is %d to %d digits", ErrBadInput, pinMinLen, pinMaxLen)
	}
	a, err := s.Adult(ctx, accountID)
	if err != nil {
		return err
	}
	if !a.Verified {
		return ErrNotAdult
	}
	h, err := hashPassword(pin)
	if err != nil {
		return err
	}
	_, err = s.DB.Exec(ctx, `UPDATE accounts SET adult_pin_hash = $2, adult_pin_set_at = now(), adult_pin_tries = 0, adult_pin_paused_until = NULL WHERE id = $1`, accountID, h)
	return err
}

// IssueAdultCode sends a one-time code for the next adult payment stage.
func (s Store) IssueAdultCode(ctx context.Context, accountID string) (CodeIssued, error) {
	a, err := s.Adult(ctx, accountID)
	if err != nil {
		return CodeIssued{}, err
	}
	if !a.Verified {
		return CodeIssued{}, ErrNotAdult
	}
	if !a.PINSet {
		return CodeIssued{}, ErrNoPIN
	}
	var email, name, phone string
	if err := s.DB.QueryRow(ctx, `SELECT email, name, CASE WHEN phone_verified_at IS NOT NULL THEN coalesce(phone, '') ELSE '' END FROM accounts WHERE id = $1`, accountID).Scan(&email, &name, &phone); err != nil {
		return CodeIssued{}, err
	}
	return s.issue(ctx, accountID, email, name, phone, "adult")
}

// AdultGrant checks the PIN and the code together and returns a one-use grant for one payment.
// Wrong PINs and wrong codes both count, and both pause after five tries.
func (s Store) AdultGrant(ctx context.Context, accountID, pin, code string) (string, error) {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	var hash *string
	var tries int
	var paused *time.Time
	if err := tx.QueryRow(ctx, `SELECT adult_pin_hash, adult_pin_tries, adult_pin_paused_until FROM accounts WHERE id = $1 FOR UPDATE`, accountID).Scan(&hash, &tries, &paused); err != nil {
		return "", err
	}
	if hash == nil {
		return "", ErrNoPIN
	}
	if paused != nil && time.Now().Before(*paused) {
		return "", ErrPINPaused
	}
	if !checkPassword(*hash, pin) {
		tries++
		out := ErrBadPIN
		var until *time.Time
		if tries >= PINTries {
			t := time.Now().Add(PINPause)
			until, tries, out = &t, 0, ErrPINPaused
		}
		if _, err := tx.Exec(ctx, `UPDATE accounts SET adult_pin_tries = $2, adult_pin_paused_until = $3 WHERE id = $1`, accountID, tries, until); err != nil {
			return "", err
		}
		return "", errors.Join(out, tx.Commit(ctx))
	}
	if _, err := tx.Exec(ctx, `UPDATE accounts SET adult_pin_tries = 0, adult_pin_paused_until = NULL WHERE id = $1`, accountID); err != nil {
		return "", err
	}
	if err := s.checkCode(ctx, tx, accountID, "adult", code); err != nil {
		if errors.Is(err, ErrBadCode) || errors.Is(err, ErrPaused) || errors.Is(err, ErrCodeExpired) {
			_ = tx.Commit(ctx) // keep the spent try
		}
		return "", err
	}
	grant, err := newToken()
	if err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO auth_codes (account_id, purpose, code_hash, expires_at) VALUES ($1, 'adult-grant', $2, now() + $3::interval)`,
		accountID, hashToken(accountID+":"+grant), GrantFor.String()); err != nil {
		return "", err
	}
	return grant, tx.Commit(ctx)
}

// UseAdultGrant spends a grant made by AdultGrant. Each grant pays for exactly one stage.
func (s Store) UseAdultGrant(ctx context.Context, accountID, grant string) error {
	tag, err := s.DB.Exec(ctx, `UPDATE auth_codes SET used_at = now()
	  WHERE account_id = $1 AND purpose = 'adult-grant' AND code_hash = $2 AND used_at IS NULL AND expires_at > now()`,
		accountID, hashToken(accountID+":"+grant))
	if err == nil && tag.RowsAffected() == 0 {
		return ErrBadGrant
	}
	return err
}
