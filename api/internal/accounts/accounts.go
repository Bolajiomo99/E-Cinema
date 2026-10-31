// Package accounts signs viewers up and in, verifies their phone and limits signed-in devices.
package accounts

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"math/big"
	"net/mail"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrBadInput       = errors.New("invalid input")
	ErrEmailTaken     = errors.New("an account already uses this email, sign in instead")
	ErrBadLogin       = errors.New("email or password is wrong")
	ErrLocked         = errors.New("too many attempts, try again in 15 minutes")
	ErrNoSession      = errors.New("not signed in")
	ErrPhoneTaken     = errors.New("this phone number already has an E-Cinema account, sign in to that one instead")
	ErrBadCode        = errors.New("that code is wrong or has expired")
	ErrTooSoon        = errors.New("wait a minute before asking for another code")
	ErrSMSUnavailable = errors.New("phone checks are not switched on yet")
	ErrNotFound       = errors.New("not found")
)

const (
	// MaxDevices is how many devices one account may be signed in on; a new sign-in signs out the oldest.
	MaxDevices     = 2
	SessionFor     = 30 * 24 * time.Hour
	codeFor        = 10 * time.Minute
	codeResend     = time.Minute
	codeAttempts   = 5
	failWindow     = 15 * time.Minute
	failLimit      = 10
	minPasswordLen = 10
)

// SMS sends a text message. Nil means phone checks are unavailable.
type SMS interface {
	Send(ctx context.Context, to, text string) error
}

type Store struct {
	DB  *pgxpool.Pool
	SMS SMS
	// WebAuthn signs in with passkeys; nil until the site's domain is configured.
	WebAuthn *webauthn.WebAuthn
}

type Account struct {
	ID            string    `json:"id"`
	Email         string    `json:"email"`
	Name          string    `json:"name"`
	Phone         string    `json:"phone,omitempty"`
	PhoneVerified bool      `json:"phoneVerified"`
	FaceVerified  bool      `json:"faceVerified"`
	IDVerified    bool      `json:"idVerified"`
	CreatedAt     time.Time `json:"createdAt"`
}

type Session struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expiresAt"`
	// SignedOut counts older devices signed out to stay within MaxDevices.
	SignedOut int `json:"signedOut"`
	// Restored is set when signing in cancelled a scheduled deletion.
	Restored bool `json:"restored,omitempty"`
	// Alert asks the web app to send a "new sign-in" email: login alerts are on and this device is new.
	Alert bool `json:"alert,omitempty"`
}

type Device struct {
	ID         string    `json:"id"`
	Device     string    `json:"device"`
	CreatedAt  time.Time `json:"createdAt"`
	LastSeenAt time.Time `json:"lastSeenAt"`
	Current    bool      `json:"current"`
}

func hashToken(token string) []byte {
	h := sha256.Sum256([]byte(token))
	return h[:]
}

func newToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func cleanDevice(d string) string {
	d = strings.TrimSpace(d)
	if d == "" {
		return "Unknown device"
	}
	if utf8.RuneCountInString(d) > 80 {
		d = string([]rune(d)[:80])
	}
	return d
}

func normEmail(e string) (string, bool) {
	e = strings.ToLower(strings.TrimSpace(e))
	a, err := mail.ParseAddress(e)
	if err != nil || a.Address != e || len(e) > 254 {
		return "", false
	}
	return e, true
}

const accountCols = `id, email, name, coalesce(phone, ''), phone_verified_at IS NOT NULL, face_verified_at IS NOT NULL, id_verified_at IS NOT NULL, created_at`

func scanAccount(row pgx.Row) (Account, error) {
	var a Account
	err := row.Scan(&a.ID, &a.Email, &a.Name, &a.Phone, &a.PhoneVerified, &a.FaceVerified, &a.IDVerified, &a.CreatedAt)
	return a, err
}

// SignUp creates the account and signs it in on this device.
func (s Store) SignUp(ctx context.Context, email, name, password, device string) (Account, Session, error) {
	email, ok := normEmail(email)
	name = strings.TrimSpace(name)
	if !ok || name == "" || utf8.RuneCountInString(name) > 80 {
		return Account{}, Session{}, fmt.Errorf("%w: a valid email and name are required", ErrBadInput)
	}
	if utf8.RuneCountInString(password) < minPasswordLen || len(password) > 200 {
		return Account{}, Session{}, fmt.Errorf("%w: password must be at least %d characters", ErrBadInput, minPasswordLen)
	}
	hash, err := hashPassword(password)
	if err != nil {
		return Account{}, Session{}, err
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return Account{}, Session{}, err
	}
	defer tx.Rollback(ctx)
	acct, err := scanAccount(tx.QueryRow(ctx,
		`INSERT INTO accounts (email, name, password_hash) VALUES ($1, $2, $3) RETURNING `+accountCols, email, name, hash))
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return Account{}, Session{}, ErrEmailTaken
	}
	if err != nil {
		return Account{}, Session{}, err
	}
	sess, err := startSession(ctx, tx, acct.ID, device)
	if err != nil {
		return Account{}, Session{}, err
	}
	return acct, sess, tx.Commit(ctx)
}

// SignIn checks the password and signs in on this device, signing out the oldest devices beyond MaxDevices.
func (s Store) SignIn(ctx context.Context, email, password, device string) (Account, Session, error) {
	// A verified mobile number works in place of the email.
	if _, isEmail := normEmail(email); !isEmail {
		if p, ok := NormalizePhone(email); ok {
			var found string
			if err := s.DB.QueryRow(ctx, `SELECT email FROM accounts WHERE phone = $1 AND phone_verified_at IS NOT NULL`, p).Scan(&found); err == nil {
				email = found
			}
		}
	}
	email, ok := normEmail(email)
	if !ok {
		checkPassword(dummyHash, password)
		return Account{}, Session{}, ErrBadLogin
	}
	var fails int
	if err := s.DB.QueryRow(ctx, `SELECT count(*) FROM sign_in_failures WHERE email = $1 AND at > now() - $2::interval`,
		email, failWindow.String()).Scan(&fails); err != nil {
		return Account{}, Session{}, err
	}
	if fails >= failLimit {
		return Account{}, Session{}, ErrLocked
	}
	var hash string
	err := s.DB.QueryRow(ctx, `SELECT password_hash FROM accounts WHERE email = $1`, email).Scan(&hash)
	if errors.Is(err, pgx.ErrNoRows) {
		hash = dummyHash
	} else if err != nil {
		return Account{}, Session{}, err
	}
	if !checkPassword(hash, password) || errors.Is(err, pgx.ErrNoRows) {
		if _, err := s.DB.Exec(ctx, `INSERT INTO sign_in_failures (email) VALUES ($1)`, email); err != nil {
			return Account{}, Session{}, err
		}
		return Account{}, Session{}, ErrBadLogin
	}
	var twoStep bool
	if err := s.DB.QueryRow(ctx, `SELECT two_step FROM accounts WHERE email = $1`, email).Scan(&twoStep); err != nil {
		return Account{}, Session{}, err
	}
	if twoStep {
		if _, err := s.DB.Exec(ctx, `DELETE FROM sign_in_failures WHERE email = $1`, email); err != nil {
			return Account{}, Session{}, err
		}
		return Account{Email: email}, Session{}, ErrSecondStep
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return Account{}, Session{}, err
	}
	defer tx.Rollback(ctx)
	acct, err := scanAccount(tx.QueryRow(ctx, `SELECT `+accountCols+` FROM accounts WHERE email = $1 FOR UPDATE`, email))
	if err != nil {
		return Account{}, Session{}, err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM sign_in_failures WHERE email = $1`, email); err != nil {
		return Account{}, Session{}, err
	}
	sess, err := startSession(ctx, tx, acct.ID, device)
	if err != nil {
		return Account{}, Session{}, err
	}
	return acct, sess, tx.Commit(ctx)
}

// startSession must run inside a transaction holding the account row, so two
// simultaneous sign-ins cannot both slip under the device limit.
func startSession(ctx context.Context, tx pgx.Tx, accountID, device string) (Session, error) {
	var restored, alerts, known bool
	if err := tx.QueryRow(ctx, `SELECT delete_after IS NOT NULL, login_alerts,
		EXISTS (SELECT 1 FROM account_sessions WHERE account_id = $1 AND device = $2)
		FROM accounts WHERE id = $1 FOR UPDATE`, accountID, cleanDevice(device)).Scan(&restored, &alerts, &known); err != nil {
		return Session{}, err
	}
	if restored {
		if _, err := tx.Exec(ctx, `UPDATE accounts SET delete_after = NULL WHERE id = $1`, accountID); err != nil {
			return Session{}, err
		}
	}
	token, err := newToken()
	if err != nil {
		return Session{}, err
	}
	expires := time.Now().Add(SessionFor).UTC().Truncate(time.Second)
	if _, err := tx.Exec(ctx, `INSERT INTO account_sessions (account_id, token_hash, device, expires_at) VALUES ($1, $2, $3, $4)`,
		accountID, hashToken(token), cleanDevice(device), expires); err != nil {
		return Session{}, err
	}
	tag, err := tx.Exec(ctx, `
		UPDATE account_sessions SET revoked_at = now()
		WHERE id IN (
			SELECT id FROM account_sessions
			WHERE account_id = $1 AND revoked_at IS NULL AND expires_at > now()
			ORDER BY last_seen_at DESC, created_at DESC
			OFFSET $2
		)`, accountID, MaxDevices)
	if err != nil {
		return Session{}, err
	}
	return Session{Token: token, ExpiresAt: expires, SignedOut: int(tag.RowsAffected()), Restored: restored, Alert: alerts && !known}, nil
}

// Authenticate returns the account behind a session token and marks the device as seen.
func (s Store) Authenticate(ctx context.Context, token string) (Account, string, error) {
	if token == "" {
		return Account{}, "", ErrNoSession
	}
	var sessionID string
	err := s.DB.QueryRow(ctx, `
		UPDATE account_sessions SET last_seen_at = now()
		WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
		RETURNING id`, hashToken(token)).Scan(&sessionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Account{}, "", ErrNoSession
	}
	if err != nil {
		return Account{}, "", err
	}
	acct, err := scanAccount(s.DB.QueryRow(ctx,
		`SELECT `+accountCols+` FROM accounts WHERE id = (SELECT account_id FROM account_sessions WHERE id = $1)`, sessionID))
	return acct, sessionID, err
}

func (s Store) SignOut(ctx context.Context, token string) error {
	_, err := s.DB.Exec(ctx, `UPDATE account_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, hashToken(token))
	return err
}

func (s Store) Devices(ctx context.Context, accountID, currentSession string) ([]Device, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT id, device, created_at, last_seen_at FROM account_sessions
		WHERE account_id = $1 AND revoked_at IS NULL AND expires_at > now()
		ORDER BY last_seen_at DESC`, accountID)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Device, error) {
		var d Device
		err := r.Scan(&d.ID, &d.Device, &d.CreatedAt, &d.LastSeenAt)
		d.Current = d.ID == currentSession
		return d, err
	})
	if list == nil {
		list = []Device{}
	}
	return list, err
}

func (s Store) SignOutDevice(ctx context.Context, accountID, sessionID string) error {
	tag, err := s.DB.Exec(ctx, `UPDATE account_sessions SET revoked_at = now() WHERE id::text = $1 AND account_id = $2 AND revoked_at IS NULL`, sessionID, accountID)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

var phoneRE = regexp.MustCompile(`^\+[1-9][0-9]{7,14}$`)

// NormalizePhone turns "0803 555 0142" style input into E.164, assuming Nigeria when no country code is given.
func NormalizePhone(p string) (string, bool) {
	p = strings.NewReplacer(" ", "", "-", "", "(", "", ")", "").Replace(strings.TrimSpace(p))
	if strings.HasPrefix(p, "00") {
		p = "+" + p[2:]
	}
	if strings.HasPrefix(p, "0") && len(p) == 11 {
		p = "+234" + p[1:]
	}
	return p, phoneRE.MatchString(p)
}

func newCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

// StartPhoneCheck texts a 6-digit code to the phone number.
func (s Store) StartPhoneCheck(ctx context.Context, accountID, phone string) (string, error) {
	phone, ok := NormalizePhone(phone)
	if !ok {
		return "", fmt.Errorf("%w: enter the phone number with its country code, like +234 803 555 0142", ErrBadInput)
	}
	if s.SMS == nil {
		return "", ErrSMSUnavailable
	}
	var taken bool
	if err := s.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM accounts WHERE phone = $1 AND phone_verified_at IS NOT NULL AND id <> $2)`,
		phone, accountID).Scan(&taken); err != nil {
		return "", err
	}
	if taken {
		return "", ErrPhoneTaken
	}
	var recent bool
	if err := s.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM phone_codes WHERE account_id = $1 AND sent_at > now() - $2::interval)`,
		accountID, codeResend.String()).Scan(&recent); err != nil {
		return "", err
	}
	if recent {
		return "", ErrTooSoon
	}
	code, err := newCode()
	if err != nil {
		return "", err
	}
	if _, err := s.DB.Exec(ctx, `
		INSERT INTO phone_codes (account_id, phone, code_hash, expires_at) VALUES ($1, $2, $3, now() + $4::interval)
		ON CONFLICT (account_id) DO UPDATE SET phone = $2, code_hash = $3, attempts = 0, sent_at = now(), expires_at = now() + $4::interval`,
		accountID, phone, hashToken(accountID+":"+code), codeFor.String()); err != nil {
		return "", err
	}
	if err := s.SMS.Send(ctx, phone, fmt.Sprintf("Your E-Cinema code is %s. It expires in 10 minutes. Never share it with anyone.", code)); err != nil {
		s.DB.Exec(ctx, `DELETE FROM phone_codes WHERE account_id = $1`, accountID)
		return "", err
	}
	return phone, nil
}

// ConfirmPhone checks the code and marks the phone verified.
func (s Store) ConfirmPhone(ctx context.Context, accountID, code string) (Account, error) {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return Account{}, err
	}
	defer tx.Rollback(ctx)
	var phone string
	var hash []byte
	var attempts int
	err = tx.QueryRow(ctx, `SELECT phone, code_hash, attempts FROM phone_codes WHERE account_id = $1 AND expires_at > now() FOR UPDATE`,
		accountID).Scan(&phone, &hash, &attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return Account{}, ErrBadCode
	}
	if err != nil {
		return Account{}, err
	}
	if attempts >= codeAttempts || string(hash) != string(hashToken(accountID+":"+strings.TrimSpace(code))) {
		if _, err := tx.Exec(ctx, `UPDATE phone_codes SET attempts = attempts + 1 WHERE account_id = $1`, accountID); err != nil {
			return Account{}, err
		}
		return Account{}, errors.Join(ErrBadCode, tx.Commit(ctx))
	}
	if _, err := tx.Exec(ctx, `DELETE FROM phone_codes WHERE account_id = $1`, accountID); err != nil {
		return Account{}, err
	}
	acct, err := scanAccount(tx.QueryRow(ctx,
		`UPDATE accounts SET phone = $2, phone_verified_at = now() WHERE id = $1 RETURNING `+accountCols, accountID, phone))
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return Account{}, ErrPhoneTaken
	}
	if err != nil {
		return Account{}, err
	}
	return acct, tx.Commit(ctx)
}
