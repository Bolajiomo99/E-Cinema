package accounts

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

const (
	CodeFor       = 10 * time.Minute // a code works for 10 minutes
	CodeTries     = 5                // then resets pause
	CodePause     = 30 * time.Minute
	CodeResendGap = time.Minute
	ResetPassLen  = 12
	resetTokenFor = 15 * time.Minute
	lockTokenFor  = 7 * 24 * time.Hour
)

var (
	ErrCodeExpired = errors.New("that code has expired")
	ErrPaused      = errors.New("too many wrong codes; resets are paused for 30 minutes to protect the account")
	ErrReusedPass  = errors.New("choose a password you have not used for this account before")
	ErrShortReset  = fmt.Errorf("%w: your new password needs at least %d characters", ErrBadInput, ResetPassLen)
)

// CodeIssued tells the caller where to send the code. The caller must answer the same way
// whether or not an account was found, so codes cannot be used to discover who has an account.
type CodeIssued struct {
	Found     bool   `json:"found"`
	Code      string `json:"code,omitempty"`
	Email     string `json:"email,omitempty"`
	Name      string `json:"name,omitempty"`
	Phone     string `json:"phone,omitempty"` // set when the code goes by text message
	MaskedTo  string `json:"maskedTo"`
	PausedFor int    `json:"pausedFor,omitempty"` // seconds
}

func sixDigits() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

// MaskEmail turns tolu@example.com into t•••@example.com.
func MaskEmail(e string) string {
	at := strings.IndexByte(e, '@')
	if at < 1 {
		return "your email"
	}
	r, _ := utf8.DecodeRuneInString(e)
	return string(r) + "•••" + e[at:]
}

// MaskPhone turns +2348035550142 into +234 •••• 0142.
func MaskPhone(p string) string {
	if len(p) < 8 {
		return "your phone"
	}
	return p[:4] + " •••• " + p[len(p)-4:]
}

// findAccount resolves an email, or a verified mobile number, to an account.
func (s Store) findAccount(ctx context.Context, id string) (acctID, email, name, phone string, err error) {
	if e, ok := normEmail(id); ok {
		err = s.DB.QueryRow(ctx, `SELECT id, email, name, coalesce(phone, '') FROM accounts WHERE email = $1`, e).Scan(&acctID, &email, &name, &phone)
		phone = ""
	} else if p, ok := NormalizePhone(id); ok {
		err = s.DB.QueryRow(ctx, `SELECT id, email, name, phone FROM accounts WHERE phone = $1 AND phone_verified_at IS NOT NULL`, p).Scan(&acctID, &email, &name, &phone)
	} else {
		return "", "", "", "", fmt.Errorf("%w: enter your email or mobile number", ErrBadInput)
	}
	return
}

// pausedUntil reports when an account may get a new code after too many wrong tries.
func (s Store) pausedUntil(ctx context.Context, acctID, purpose string) (time.Time, error) {
	var until *time.Time
	err := s.DB.QueryRow(ctx, `SELECT max(created_at) + $3::interval FROM auth_codes
		WHERE account_id = $1 AND purpose = $2 AND tries >= $4 AND created_at > now() - $3::interval`,
		acctID, purpose, CodePause.String(), CodeTries).Scan(&until)
	if err != nil || until == nil {
		return time.Time{}, err
	}
	return *until, nil
}

// IssueCode creates a 6-digit code for signing in ("login") or resetting a password ("reset").
// When the identifier is a verified phone and texts are on, the code is texted here; otherwise
// the caller emails it.
func (s Store) IssueCode(ctx context.Context, identifier, purpose string) (CodeIssued, error) {
	if purpose != "login" && purpose != "reset" {
		return CodeIssued{}, fmt.Errorf("%w: unknown code purpose", ErrBadInput)
	}
	acctID, email, name, phone, err := s.findAccount(ctx, identifier)
	if errors.Is(err, pgx.ErrNoRows) {
		masked := MaskEmail(strings.TrimSpace(identifier))
		if p, ok := NormalizePhone(identifier); ok && !strings.Contains(identifier, "@") {
			masked = MaskPhone(p)
		}
		return CodeIssued{Found: false, MaskedTo: masked}, nil
	}
	if err != nil {
		return CodeIssued{}, err
	}
	return s.issue(ctx, acctID, email, name, phone, purpose)
}

// issue makes and stores a fresh code for a known account, texting it when it can.
func (s Store) issue(ctx context.Context, acctID, email, name, phone, purpose string) (CodeIssued, error) {
	if until, err := s.pausedUntil(ctx, acctID, purpose); err != nil {
		return CodeIssued{}, err
	} else if time.Until(until) > 0 {
		return CodeIssued{Found: true, PausedFor: int(time.Until(until).Seconds())}, ErrPaused
	}
	var recent int
	if err := s.DB.QueryRow(ctx, `SELECT count(*) FROM auth_codes WHERE account_id = $1 AND purpose = $2 AND created_at > now() - $3::interval`,
		acctID, purpose, CodeResendGap.String()).Scan(&recent); err != nil {
		return CodeIssued{}, err
	}
	if recent > 0 {
		return CodeIssued{}, ErrTooSoon
	}
	code, err := sixDigits()
	if err != nil {
		return CodeIssued{}, err
	}
	// A new code replaces any older one for the same purpose.
	if _, err := s.DB.Exec(ctx, `UPDATE auth_codes SET used_at = now() WHERE account_id = $1 AND purpose = $2 AND used_at IS NULL`, acctID, purpose); err != nil {
		return CodeIssued{}, err
	}
	if _, err := s.DB.Exec(ctx, `INSERT INTO auth_codes (account_id, purpose, code_hash, expires_at) VALUES ($1, $2, $3, now() + $4::interval)`,
		acctID, purpose, hashToken(acctID+":"+code), CodeFor.String()); err != nil {
		return CodeIssued{}, err
	}
	out := CodeIssued{Found: true, Email: email, Name: name, MaskedTo: MaskEmail(email)}
	if phone != "" && s.SMS != nil {
		if err := s.SMS.Send(ctx, phone, fmt.Sprintf("Your E-Cinema code is %s. It works for 10 minutes. Never share it.", code)); err == nil {
			out.Phone, out.MaskedTo = phone, MaskPhone(phone)
			return out, nil
		}
	}
	out.Code = code
	return out, nil
}

// checkCode spends one try on the newest live code. A match marks it used.
func (s Store) checkCode(ctx context.Context, tx pgx.Tx, acctID, purpose, code string) error {
	var id string
	var hash []byte
	var tries int
	var expires time.Time
	err := tx.QueryRow(ctx, `SELECT id, code_hash, tries, expires_at FROM auth_codes
		WHERE account_id = $1 AND purpose = $2 AND used_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
		acctID, purpose).Scan(&id, &hash, &tries, &expires)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrBadCode
	}
	if err != nil {
		return err
	}
	if tries >= CodeTries {
		return ErrPaused
	}
	if time.Now().After(expires) {
		return ErrCodeExpired
	}
	if string(hash) != string(hashToken(acctID+":"+strings.TrimSpace(code))) {
		if _, err := tx.Exec(ctx, `UPDATE auth_codes SET tries = tries + 1 WHERE id = $1`, id); err != nil {
			return err
		}
		if tries+1 >= CodeTries {
			return ErrPaused
		}
		return ErrBadCode
	}
	_, err = tx.Exec(ctx, `UPDATE auth_codes SET used_at = now() WHERE id = $1`, id)
	return err
}

// SignInWithCode signs in with a one-time login code instead of a password.
func (s Store) SignInWithCode(ctx context.Context, identifier, code, device string) (Account, Session, error) {
	acctID, _, _, _, err := s.findAccount(ctx, identifier)
	if errors.Is(err, pgx.ErrNoRows) {
		return Account{}, Session{}, ErrBadCode
	}
	if err != nil {
		return Account{}, Session{}, err
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return Account{}, Session{}, err
	}
	defer tx.Rollback(ctx)
	if err := s.checkCode(ctx, tx, acctID, "login", code); err != nil {
		if errors.Is(err, ErrBadCode) || errors.Is(err, ErrPaused) || errors.Is(err, ErrCodeExpired) {
			_ = tx.Commit(ctx) // keep the spent try
		}
		return Account{}, Session{}, err
	}
	acct, err := scanAccount(tx.QueryRow(ctx, `SELECT `+accountCols+` FROM accounts WHERE id = $1`, acctID))
	if err != nil {
		return Account{}, Session{}, err
	}
	sess, err := s.startSession(ctx, tx, acctID, device)
	if err != nil {
		return Account{}, Session{}, err
	}
	return acct, sess, tx.Commit(ctx)
}

// VerifyResetCode swaps a correct reset code for a short-lived reset token.
func (s Store) VerifyResetCode(ctx context.Context, identifier, code string) (string, error) {
	acctID, _, _, _, err := s.findAccount(ctx, identifier)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrBadCode
	}
	if err != nil {
		return "", err
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	if err := s.checkCode(ctx, tx, acctID, "reset", code); err != nil {
		if errors.Is(err, ErrBadCode) || errors.Is(err, ErrPaused) || errors.Is(err, ErrCodeExpired) {
			_ = tx.Commit(ctx)
		}
		return "", err
	}
	token, err := newToken()
	if err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO auth_codes (account_id, purpose, code_hash, expires_at) VALUES ($1, 'reset-token', $2, now() + $3::interval)`,
		acctID, hashToken(token), resetTokenFor.String()); err != nil {
		return "", err
	}
	return token, tx.Commit(ctx)
}

// ResetResult is what a finished reset returns: a session on this device, and a link token
// for the "This wasn't me" button in the confirmation email.
type ResetResult struct {
	Account   Account `json:"account"`
	Session   Session `json:"session"`
	LockToken string  `json:"lockToken"`
	SignedOut int     `json:"signedOutOthers"`
}

// ResetPassword sets a new password using a reset token, signs this device in and, when asked,
// signs out every other device.
func (s Store) ResetPassword(ctx context.Context, token, password, device string, signOutOthers bool) (ResetResult, error) {
	if utf8.RuneCountInString(password) < ResetPassLen || len(password) > 200 {
		return ResetResult{}, ErrShortReset
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return ResetResult{}, err
	}
	defer tx.Rollback(ctx)
	var codeID, acctID string
	err = tx.QueryRow(ctx, `SELECT id, account_id FROM auth_codes WHERE purpose = 'reset-token' AND code_hash = $1
		AND used_at IS NULL AND expires_at > now() FOR UPDATE`, hashToken(token)).Scan(&codeID, &acctID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ResetResult{}, ErrBadCode
	}
	if err != nil {
		return ResetResult{}, err
	}
	if err := setPassword(ctx, tx, acctID, password); err != nil {
		return ResetResult{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE auth_codes SET used_at = now() WHERE id = $1`, codeID); err != nil {
		return ResetResult{}, err
	}
	var res ResetResult
	if signOutOthers {
		tag, err := tx.Exec(ctx, `UPDATE account_sessions SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL`, acctID)
		if err != nil {
			return ResetResult{}, err
		}
		res.SignedOut = int(tag.RowsAffected())
	}
	if _, err := tx.Exec(ctx, `DELETE FROM sign_in_failures WHERE email = (SELECT email FROM accounts WHERE id = $1)`, acctID); err != nil {
		return ResetResult{}, err
	}
	if res.Session, err = s.startSession(ctx, tx, acctID, device); err != nil {
		return ResetResult{}, err
	}
	if res.Account, err = scanAccount(tx.QueryRow(ctx, `SELECT `+accountCols+` FROM accounts WHERE id = $1`, acctID)); err != nil {
		return ResetResult{}, err
	}
	if res.LockToken, err = newToken(); err != nil {
		return ResetResult{}, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO auth_codes (account_id, purpose, code_hash, expires_at) VALUES ($1, 'lock', $2, now() + $3::interval)`,
		acctID, hashToken(res.LockToken), lockTokenFor.String()); err != nil {
		return ResetResult{}, err
	}
	return res, tx.Commit(ctx)
}

// LockAccount handles "This wasn't me": every device is signed out and the password is cleared,
// so the owner must reset it again with a code.
func (s Store) LockAccount(ctx context.Context, token string) (string, error) {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	var acctID, email string
	err = tx.QueryRow(ctx, `UPDATE auth_codes c SET used_at = now() FROM accounts a
		WHERE c.purpose = 'lock' AND c.code_hash = $1 AND c.used_at IS NULL AND c.expires_at > now() AND a.id = c.account_id
		RETURNING a.id, a.email`, hashToken(token)).Scan(&acctID, &email)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrBadCode
	}
	if err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `UPDATE account_sessions SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL`, acctID); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `UPDATE accounts SET password_hash = '!locked' WHERE id = $1`, acctID); err != nil {
		return "", err
	}
	return email, tx.Commit(ctx)
}

// IssueLockToken makes a "This wasn't me" link token, for example for a new-sign-in email.
func (s Store) IssueLockToken(ctx context.Context, accountID string) (string, error) {
	token, err := newToken()
	if err != nil {
		return "", err
	}
	_, err = s.DB.Exec(ctx, `INSERT INTO auth_codes (account_id, purpose, code_hash, expires_at) VALUES ($1, 'lock', $2, now() + $3::interval)`,
		accountID, hashToken(token), lockTokenFor.String())
	return token, err
}
