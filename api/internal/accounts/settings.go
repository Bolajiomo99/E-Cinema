package accounts

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// DeleteGrace is how long a deleted account can still be restored by signing in.
const DeleteGrace = 30 * 24 * time.Hour

var (
	ErrUsernameTaken = errors.New("that username is taken")
	ErrSecondStep    = errors.New("enter the code we sent to finish signing in")
	ErrWrongPassword = errors.New("your current password is wrong")
	ErrLastSignIn    = errors.New("add a password or passkey before removing your only way to sign in")
	usernameRe       = regexp.MustCompile(`^[a-z0-9._]{3,20}$`)
)

// Identity is a connected sign-in such as Google.
type Identity struct {
	Provider string    `json:"provider"`
	Email    string    `json:"email"`
	Added    time.Time `json:"added"`
}

// Settings is everything the settings pages show beyond the account and profile.
type Settings struct {
	Username          string          `json:"username"`
	HasPassword       bool            `json:"hasPassword"`
	PasswordChangedAt *time.Time      `json:"passwordChangedAt"`
	TwoStep           bool            `json:"twoStep"`
	LoginAlerts       bool            `json:"loginAlerts"`
	Prefs             json.RawMessage `json:"prefs"`
	DeleteAfter       *time.Time      `json:"deleteAfter"`
	Identities        []Identity      `json:"identities"`
	Passkeys          int             `json:"passkeys"`
}

// prefKeys lists every preference a page may store, with the values it may take.
// Booleans are written as "bool"; anything else is a closed list.
var prefKeys = map[string][]string{
	"subtitles":       {"off", "en", "yo", "ha", "ig", "fr", "hi", "ko", "es", "pt", "de", "ar", "sw"},
	"translateChat":   {"bool"},
	"voiceLanguage":   {"auto", "en", "yo", "ha", "ig", "fr", "hi", "ko", "es", "pt", "de", "ar", "sw"},
	"volumeBoost":     {"bool"},
	"dialogue":        {"bool"},
	"quality":         {"auto", "480p", "1080p", "4k", "audio"},
	"wifiOnly4k":      {"bool"},
	"lowBattery":      {"bool"},
	"preloadTrailers": {"bool"},
	"showOnMap":       {"bool"},
	"friendsSee":      {"bool"},
	"showReviews":     {"bool"},
	"messages":        {"everyone", "friends", "none"},
	"personalised":    {"bool"},
	"autoTranslate":   {"bool"},
	"quietHours":      {"bool"},
	"bestTime":        {"bool"},
}

// notifyEvents × notifyChannels are the switches on the notifications page, stored as "n.<event>.<channel>".
var (
	notifyEvents   = []string{"premieres", "onSale", "friendRoom", "orders", "preorder", "features"}
	notifyChannels = []string{"push", "email", "sms", "whatsapp"}
)

func validPref(key string, v any) bool {
	if strings.HasPrefix(key, "n.") {
		parts := strings.Split(key, ".")
		if len(parts) != 3 || !contains(notifyEvents, parts[1]) || !contains(notifyChannels, parts[2]) {
			return false
		}
		_, ok := v.(bool)
		return ok
	}
	allowed, ok := prefKeys[key]
	if !ok {
		return false
	}
	if allowed[0] == "bool" {
		_, ok := v.(bool)
		return ok
	}
	s, ok := v.(string)
	return ok && contains(allowed, s)
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// GetSettings reads the settings for one account.
func (s Store) GetSettings(ctx context.Context, accountID string) (Settings, error) {
	var out Settings
	var username *string
	err := s.DB.QueryRow(ctx, `SELECT username, password_hash LIKE '$argon2id$%', password_changed_at, two_step, login_alerts, prefs, delete_after,
		(SELECT count(*) FROM passkeys WHERE account_id = a.id) FROM accounts a WHERE id = $1`, accountID).
		Scan(&username, &out.HasPassword, &out.PasswordChangedAt, &out.TwoStep, &out.LoginAlerts, &out.Prefs, &out.DeleteAfter, &out.Passkeys)
	if errors.Is(err, pgx.ErrNoRows) {
		return Settings{}, ErrNotFound
	}
	if err != nil {
		return Settings{}, err
	}
	if username != nil {
		out.Username = *username
	}
	rows, err := s.DB.Query(ctx, `SELECT provider, coalesce(email, ''), created_at FROM account_identities WHERE account_id = $1 ORDER BY created_at`, accountID)
	if err != nil {
		return Settings{}, err
	}
	defer rows.Close()
	out.Identities = []Identity{}
	for rows.Next() {
		var i Identity
		if err := rows.Scan(&i.Provider, &i.Email, &i.Added); err != nil {
			return Settings{}, err
		}
		out.Identities = append(out.Identities, i)
	}
	return out, rows.Err()
}

// SettingsChange holds the fields a settings page may change; nil leaves a field as it is.
type SettingsChange struct {
	Name        *string        `json:"name"`
	Username    *string        `json:"username"`
	TwoStep     *bool          `json:"twoStep"`
	LoginAlerts *bool          `json:"loginAlerts"`
	Prefs       map[string]any `json:"prefs"`
}

// UpdateSettings applies a change and returns the new settings.
func (s Store) UpdateSettings(ctx context.Context, accountID string, c SettingsChange) (Settings, error) {
	if c.Name != nil {
		n := strings.TrimSpace(*c.Name)
		if n == "" || utf8.RuneCountInString(n) > 80 {
			return Settings{}, fmt.Errorf("%w: enter a display name of up to 80 characters", ErrBadInput)
		}
		c.Name = &n
	}
	if c.Username != nil {
		u := strings.ToLower(strings.TrimPrefix(strings.TrimSpace(*c.Username), "@"))
		if !usernameRe.MatchString(u) {
			return Settings{}, fmt.Errorf("%w: usernames are 3 to 20 letters, numbers, dots or underscores", ErrBadInput)
		}
		c.Username = &u
	}
	for k, v := range c.Prefs {
		if !validPref(k, v) {
			return Settings{}, fmt.Errorf("%w: unknown setting %q", ErrBadInput, k)
		}
	}
	prefs, _ := json.Marshal(c.Prefs)
	if c.Prefs == nil {
		prefs = []byte("{}")
	}
	_, err := s.DB.Exec(ctx, `UPDATE accounts SET
		name = coalesce($2, name), username = coalesce($3, username),
		two_step = coalesce($4, two_step), login_alerts = coalesce($5, login_alerts),
		prefs = prefs || $6::jsonb
		WHERE id = $1`, accountID, c.Name, c.Username, c.TwoStep, c.LoginAlerts, string(prefs))
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return Settings{}, ErrUsernameTaken
	}
	if err != nil {
		return Settings{}, err
	}
	return s.GetSettings(ctx, accountID)
}

// ChangePassword swaps the password when the current one is right. Other devices stay signed in.
func (s Store) ChangePassword(ctx context.Context, accountID, current, next string) error {
	if utf8.RuneCountInString(next) < ResetPassLen || len(next) > 200 {
		return ErrShortReset
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var hash string
	if err := tx.QueryRow(ctx, `SELECT password_hash FROM accounts WHERE id = $1 FOR UPDATE`, accountID).Scan(&hash); err != nil {
		return err
	}
	if strings.HasPrefix(hash, "$argon2id$") && !checkPassword(hash, current) {
		return ErrWrongPassword
	}
	if err := setPassword(ctx, tx, accountID, next); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// setPassword refuses the last five passwords, keeps history and stamps the change.
func setPassword(ctx context.Context, tx pgx.Tx, accountID, password string) error {
	rows, err := tx.Query(ctx, `(SELECT password_hash FROM accounts WHERE id = $1)
		UNION ALL (SELECT password_hash FROM password_history WHERE account_id = $1 ORDER BY created_at DESC LIMIT 4)`, accountID)
	if err != nil {
		return err
	}
	var old []string
	for rows.Next() {
		var h string
		if err := rows.Scan(&h); err != nil {
			rows.Close()
			return err
		}
		old = append(old, h)
	}
	rows.Close()
	for _, h := range old {
		if checkPassword(h, password) {
			return ErrReusedPass
		}
	}
	hash, err := hashPassword(password)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO password_history (account_id, password_hash) SELECT id, password_hash FROM accounts WHERE id = $1 AND password_hash LIKE '$argon2id$%'`, accountID); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE accounts SET password_hash = $2, password_changed_at = now() WHERE id = $1`, accountID, hash)
	return err
}

// SignOutEverywhere ends every session on the account, this one included.
func (s Store) SignOutEverywhere(ctx context.Context, accountID string) (int, error) {
	tag, err := s.DB.Exec(ctx, `UPDATE account_sessions SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL`, accountID)
	return int(tag.RowsAffected()), err
}

// RemoveIdentity disconnects a provider unless it is the only way left to sign in.
func (s Store) RemoveIdentity(ctx context.Context, accountID, provider string) error {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var others int
	if err := tx.QueryRow(ctx, `SELECT (CASE WHEN password_hash LIKE '$argon2id$%' THEN 1 ELSE 0 END)
		+ (SELECT count(*) FROM passkeys WHERE account_id = a.id)
		+ (SELECT count(*) FROM account_identities WHERE account_id = a.id AND provider <> $2)
		FROM accounts a WHERE id = $1 FOR UPDATE`, accountID, provider).Scan(&others); err != nil {
		return err
	}
	if others == 0 {
		return ErrLastSignIn
	}
	tag, err := tx.Exec(ctx, `DELETE FROM account_identities WHERE account_id = $1 AND provider = $2`, accountID, provider)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return tx.Commit(ctx)
}

// UpcomingTickets counts paid seats for screenings that have not started, for the delete warning.
func (s Store) UpcomingTickets(ctx context.Context, accountID string) (int, error) {
	var n int
	err := s.DB.QueryRow(ctx, `SELECT count(*) FROM holds h JOIN showtimes st ON st.id = h.showtime_id
		WHERE h.account_id = $1 AND h.status = 'paid' AND st.starts_at > now()`, accountID).Scan(&n)
	return n, err
}

// ScheduleDelete marks the account for deletion after the grace period and signs it out everywhere.
// Signing in again before then cancels it.
func (s Store) ScheduleDelete(ctx context.Context, accountID string) (time.Time, error) {
	var at time.Time
	if err := s.DB.QueryRow(ctx, `UPDATE accounts SET delete_after = now() + $2::interval WHERE id = $1 RETURNING delete_after`,
		accountID, DeleteGrace.String()).Scan(&at); err != nil {
		return time.Time{}, err
	}
	_, err := s.SignOutEverywhere(ctx, accountID)
	return at, err
}

// PurgeDeleted removes accounts whose grace period has ended. Paid seats stay for the studios'
// records but lose the link to the person.
func (s Store) PurgeDeleted(ctx context.Context) (int, error) {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `UPDATE holds SET account_id = NULL WHERE account_id IN (SELECT id FROM accounts WHERE delete_after < now())`); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(ctx, `UPDATE shop_orders SET address = jsonb_build_object('city', address->>'city', 'country', address->>'country'), rider = NULL
	  WHERE account_id IN (SELECT id FROM accounts WHERE delete_after < now())`); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM room_messages WHERE account_id IN (SELECT id FROM accounts WHERE delete_after < now())`); err != nil {
		return 0, err
	}
	tag, err := tx.Exec(ctx, `DELETE FROM accounts WHERE delete_after < now()`)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), tx.Commit(ctx)
}

// Export gathers everything held about an account for "Download my data".
func (s Store) Export(ctx context.Context, accountID string) (map[string]any, error) {
	var raw []byte
	err := s.DB.QueryRow(ctx, `SELECT json_build_object(
		'account', (SELECT json_build_object('id', id, 'email', email, 'name', name, 'username', username, 'phone', phone,
			'phoneVerifiedAt', phone_verified_at, 'faceVerifiedAt', face_verified_at, 'idVerifiedAt', id_verified_at,
			'country', country, 'birthDate', birth_date, 'gender', gender, 'appLanguage', app_language, 'audioLanguage', audio_language,
			'plan', plan, 'planStatus', plan_status, 'twoStep', two_step, 'loginAlerts', login_alerts, 'preferences', prefs,
			'createdAt', created_at, 'passwordChangedAt', password_changed_at) FROM accounts WHERE id = $1),
		'devices', coalesce((SELECT json_agg(json_build_object('device', device, 'signedInAt', created_at, 'lastSeenAt', last_seen_at, 'signedOutAt', revoked_at) ORDER BY created_at)
			FROM account_sessions WHERE account_id = $1), '[]'::json),
		'passkeys', coalesce((SELECT json_agg(json_build_object('name', name, 'addedAt', created_at)) FROM passkeys WHERE account_id = $1), '[]'::json),
		'connectedSignIn', coalesce((SELECT json_agg(json_build_object('provider', provider, 'email', email, 'addedAt', created_at)) FROM account_identities WHERE account_id = $1), '[]'::json),
		'tickets', coalesce((SELECT json_agg(json_build_object('showtime', h.showtime_id, 'film', st.film, 'startsAt', st.starts_at, 'seats', h.seats, 'status', h.status, 'createdAt', h.created_at) ORDER BY h.created_at)
			FROM holds h JOIN showtimes st ON st.id = h.showtime_id WHERE h.account_id = $1), '[]'::json),
		'chatMessages', coalesce((SELECT json_agg(json_build_object('room', showtime_id, 'text', body, 'sentAt', created_at) ORDER BY created_at) FROM room_messages WHERE account_id = $1), '[]'::json),
		'exportedAt', now())`, accountID).Scan(&raw)
	if err != nil {
		return nil, err
	}
	var out map[string]any
	return out, json.Unmarshal(raw, &out)
}
