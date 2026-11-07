package accounts

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

// noPassword marks accounts made through Google or Apple; it never matches any password.
const noPassword = "!external"

// SignInExternal signs in with a verified Google or Apple identity. A new identity links to the
// account with the same verified email, or creates a new account.
func (s Store) SignInExternal(ctx context.Context, provider, subject, email string, emailVerified bool, name, device string) (Account, Session, bool, error) {
	if (provider != "google" && provider != "apple") || subject == "" {
		return Account{}, Session{}, false, fmt.Errorf("%w: unknown sign-in provider", ErrBadInput)
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return Account{}, Session{}, false, err
	}
	defer tx.Rollback(ctx)
	created := false
	var accountID string
	err = tx.QueryRow(ctx, `SELECT account_id FROM account_identities WHERE provider = $1 AND subject = $2`, provider, subject).Scan(&accountID)
	if errors.Is(err, pgx.ErrNoRows) {
		email, ok := normEmail(email)
		if !ok || !emailVerified {
			return Account{}, Session{}, false, fmt.Errorf("%w: your %s account needs a verified email", ErrBadInput, provider)
		}
		err = tx.QueryRow(ctx, `SELECT id FROM accounts WHERE email = $1 FOR UPDATE`, email).Scan(&accountID)
		if errors.Is(err, pgx.ErrNoRows) {
			name = strings.TrimSpace(name)
			if name == "" {
				name = strings.Split(email, "@")[0]
			}
			if err = tx.QueryRow(ctx, `INSERT INTO accounts (email, name, password_hash, email_verified_at) VALUES ($1, $2, $3, now()) RETURNING id`,
				email, cleanDevice(name), noPassword).Scan(&accountID); err != nil {
				return Account{}, Session{}, false, err
			}
			created = true
		} else if err != nil {
			return Account{}, Session{}, false, err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO account_identities (provider, subject, account_id, email) VALUES ($1, $2, $3, $4)`,
			provider, subject, accountID, email); err != nil {
			return Account{}, Session{}, false, err
		}
	} else if err != nil {
		return Account{}, Session{}, false, err
	}
	acct, err := scanAccount(tx.QueryRow(ctx, `SELECT `+accountCols+` FROM accounts WHERE id = $1`, accountID))
	if err != nil {
		return Account{}, Session{}, false, err
	}
	sess, err := s.startSession(ctx, tx, accountID, device)
	if err != nil {
		return Account{}, Session{}, false, err
	}
	return acct, sess, created, tx.Commit(ctx)
}
