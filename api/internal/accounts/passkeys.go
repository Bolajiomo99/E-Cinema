package accounts

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var (
	ErrPasskeysOff = errors.New("passkeys are not switched on yet")
	ErrBadPasskey  = errors.New("that passkey could not be verified, try again")
)

const challengeFor = 5 * time.Minute

type Passkey struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	CreatedAt  time.Time  `json:"createdAt"`
	LastUsedAt *time.Time `json:"lastUsedAt,omitempty"`
}

type waUser struct {
	acct  Account
	creds []webauthn.Credential
}

func (u waUser) WebAuthnID() []byte {
	id, _ := uuid.Parse(u.acct.ID)
	return id[:]
}
func (u waUser) WebAuthnName() string                       { return u.acct.Email }
func (u waUser) WebAuthnDisplayName() string                { return u.acct.Name }
func (u waUser) WebAuthnCredentials() []webauthn.Credential { return u.creds }

func (s Store) loadUser(ctx context.Context, q interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}, accountID string) (waUser, error) {
	acct, err := scanAccount(q.QueryRow(ctx, `SELECT `+accountCols+` FROM accounts WHERE id::text = $1`, accountID))
	if err != nil {
		return waUser{}, err
	}
	rows, err := q.Query(ctx, `SELECT credential FROM passkeys WHERE account_id = $1`, acct.ID)
	if err != nil {
		return waUser{}, err
	}
	creds, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (webauthn.Credential, error) {
		var raw []byte
		var c webauthn.Credential
		if err := r.Scan(&raw); err != nil {
			return c, err
		}
		return c, json.Unmarshal(raw, &c)
	})
	return waUser{acct: acct, creds: creds}, err
}

func (s Store) saveChallenge(ctx context.Context, accountID *string, kind string, data *webauthn.SessionData) (string, error) {
	raw, err := json.Marshal(data)
	if err != nil {
		return "", err
	}
	s.DB.Exec(ctx, `DELETE FROM webauthn_challenges WHERE expires_at < now()`)
	var id string
	err = s.DB.QueryRow(ctx, `INSERT INTO webauthn_challenges (account_id, kind, data, expires_at) VALUES ($1, $2, $3, now() + $4::interval) RETURNING id`,
		accountID, kind, raw, challengeFor.String()).Scan(&id)
	return id, err
}

// takeChallenge deletes and returns a challenge so it can be used once only.
func (s Store) takeChallenge(ctx context.Context, id, kind string, accountID *string) (webauthn.SessionData, error) {
	var raw []byte
	var owner *string
	err := s.DB.QueryRow(ctx, `DELETE FROM webauthn_challenges WHERE id::text = $1 AND kind = $2 AND expires_at > now() RETURNING data, account_id::text`,
		id, kind).Scan(&raw, &owner)
	if errors.Is(err, pgx.ErrNoRows) {
		return webauthn.SessionData{}, ErrBadPasskey
	}
	if err != nil {
		return webauthn.SessionData{}, err
	}
	if accountID != nil && (owner == nil || *owner != *accountID) {
		return webauthn.SessionData{}, ErrBadPasskey
	}
	var data webauthn.SessionData
	return data, json.Unmarshal(raw, &data)
}

// BeginPasskeyRegistration returns WebAuthn creation options for a signed-in account.
func (s Store) BeginPasskeyRegistration(ctx context.Context, accountID string) (string, *protocol.CredentialCreation, error) {
	if s.WebAuthn == nil {
		return "", nil, ErrPasskeysOff
	}
	u, err := s.loadUser(ctx, s.DB, accountID)
	if err != nil {
		return "", nil, err
	}
	exclude := make([]protocol.CredentialDescriptor, len(u.creds))
	for i := range u.creds {
		exclude[i] = u.creds[i].Descriptor()
	}
	opts, data, err := s.WebAuthn.BeginRegistration(u,
		webauthn.WithResidentKeyRequirement(protocol.ResidentKeyRequirementRequired),
		webauthn.WithExclusions(exclude),
		webauthn.WithAuthenticatorSelection(protocol.AuthenticatorSelection{
			ResidentKey:      protocol.ResidentKeyRequirementRequired,
			UserVerification: protocol.VerificationRequired,
		}),
	)
	if err != nil {
		return "", nil, err
	}
	id, err := s.saveChallenge(ctx, &accountID, "register", data)
	return id, opts, err
}

// FinishPasskeyRegistration verifies the browser's response and stores the passkey.
func (s Store) FinishPasskeyRegistration(ctx context.Context, accountID, challengeID, name string, response []byte) (Passkey, error) {
	if s.WebAuthn == nil {
		return Passkey{}, ErrPasskeysOff
	}
	data, err := s.takeChallenge(ctx, challengeID, "register", &accountID)
	if err != nil {
		return Passkey{}, err
	}
	parsed, err := protocol.ParseCredentialCreationResponseBody(bytes.NewReader(response))
	if err != nil {
		return Passkey{}, ErrBadPasskey
	}
	u, err := s.loadUser(ctx, s.DB, accountID)
	if err != nil {
		return Passkey{}, err
	}
	cred, err := s.WebAuthn.CreateCredential(u, data, parsed)
	if err != nil {
		return Passkey{}, ErrBadPasskey
	}
	raw, _ := json.Marshal(cred)
	name = cleanDevice(name)
	var p Passkey
	err = s.DB.QueryRow(ctx, `INSERT INTO passkeys (id, account_id, credential, name) VALUES ($1, $2, $3, $4) RETURNING encode(id, 'hex'), name, created_at`,
		cred.ID, accountID, raw, name).Scan(&p.ID, &p.Name, &p.CreatedAt)
	return p, err
}

// BeginPasskeyLogin returns options for a sign-in where the browser picks the passkey.
func (s Store) BeginPasskeyLogin(ctx context.Context) (string, *protocol.CredentialAssertion, error) {
	if s.WebAuthn == nil {
		return "", nil, ErrPasskeysOff
	}
	opts, data, err := s.WebAuthn.BeginDiscoverableLogin(webauthn.WithUserVerification(protocol.VerificationRequired))
	if err != nil {
		return "", nil, err
	}
	id, err := s.saveChallenge(ctx, nil, "login", data)
	return id, opts, err
}

// FinishPasskeyLogin verifies the passkey and signs in on this device.
func (s Store) FinishPasskeyLogin(ctx context.Context, challengeID string, response []byte, device string) (Account, Session, error) {
	if s.WebAuthn == nil {
		return Account{}, Session{}, ErrPasskeysOff
	}
	data, err := s.takeChallenge(ctx, challengeID, "login", nil)
	if err != nil {
		return Account{}, Session{}, err
	}
	parsed, err := protocol.ParseCredentialRequestResponseBody(bytes.NewReader(response))
	if err != nil {
		return Account{}, Session{}, ErrBadPasskey
	}
	user, cred, err := s.WebAuthn.ValidatePasskeyLogin(func(_, handle []byte) (webauthn.User, error) {
		id, err := uuid.FromBytes(handle)
		if err != nil {
			return nil, ErrBadPasskey
		}
		return s.loadUser(ctx, s.DB, id.String())
	}, data, parsed)
	if err != nil || cred.Authenticator.CloneWarning {
		return Account{}, Session{}, ErrBadPasskey
	}
	acct := user.(waUser).acct
	raw, _ := json.Marshal(cred)
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return Account{}, Session{}, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `UPDATE passkeys SET credential = $2, last_used_at = now() WHERE id = $1`, cred.ID, raw); err != nil {
		return Account{}, Session{}, err
	}
	sess, err := s.startSession(ctx, tx, acct.ID, device)
	if err != nil {
		return Account{}, Session{}, err
	}
	return acct, sess, tx.Commit(ctx)
}

func (s Store) Passkeys(ctx context.Context, accountID string) ([]Passkey, error) {
	rows, err := s.DB.Query(ctx, `SELECT encode(id, 'hex'), name, created_at, last_used_at FROM passkeys WHERE account_id = $1 ORDER BY created_at`, accountID)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Passkey, error) {
		var p Passkey
		return p, r.Scan(&p.ID, &p.Name, &p.CreatedAt, &p.LastUsedAt)
	})
	if list == nil {
		list = []Passkey{}
	}
	return list, err
}

func (s Store) DeletePasskey(ctx context.Context, accountID, id string) error {
	tag, err := s.DB.Exec(ctx, `DELETE FROM passkeys WHERE encode(id, 'hex') = $1 AND account_id = $2`, id, accountID)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}
