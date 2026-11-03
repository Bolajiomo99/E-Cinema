package exec

import (
	"context"
	"encoding/json"
	"fmt"
	"net/mail"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Executive settings (Figma 83:386). Payment switches turn a checkout method off everywhere;
// "strong" makes every executive use a passkey and a finished face check; "timeout" signs
// executives out after 15 idle minutes. The CEO changes them and every change is logged.

// Defaults for every switch the platform knows, with the type each value must have.
var SettingDefaults = map[string]any{
	"pay.paystack":    true,
	"pay.flutterwave": true,
	"pay.paypal":      true,
	"pay.cod":         true,
	"sec.strong":      false,
	"sec.timeout":     false,
	"company.support": "help@e-cinema.net",
}

type AuditEntry struct {
	Actor string    `json:"actor"`
	Key   string    `json:"key"`
	Old   any       `json:"old"`
	New   any       `json:"new"`
	At    time.Time `json:"at"`
}

type SettingsPage struct {
	Values    map[string]any `json:"values"`
	Audit     []AuditEntry   `json:"audit"`
	Countries []CountryCount `json:"countries"`
	Strong    bool           `json:"strong"` // the CEO already has a passkey and a face check
}

type CountryCount struct {
	Country string `json:"country"`
	Members int    `json:"members"`
}

// Platform returns every switch with its current value. It is public: the web reads it to know
// which payment methods to offer.
func (st Store) Platform(ctx context.Context) (map[string]any, error) {
	out := make(map[string]any, len(SettingDefaults))
	for k, v := range SettingDefaults {
		out[k] = v
	}
	rows, err := st.DB.Query(ctx, `SELECT key, value FROM platform_settings`)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var k string
		var raw []byte
		if err := rows.Scan(&k, &raw); err != nil {
			return out, err
		}
		var v any
		if _, known := SettingDefaults[k]; known && json.Unmarshal(raw, &v) == nil {
			out[k] = v
		}
	}
	return out, rows.Err()
}

// StrongOK says whether an account may use the executive area under the "strong" switch.
func (st Store) StrongOK(ctx context.Context, accountID string) (bool, error) {
	var on, ok bool
	err := st.DB.QueryRow(ctx, `SELECT coalesce((SELECT value = 'true'::jsonb FROM platform_settings WHERE key = 'sec.strong'), false),
	    EXISTS (SELECT 1 FROM accounts a WHERE a.id = $1 AND a.face_verified_at IS NOT NULL AND EXISTS (SELECT 1 FROM passkeys p WHERE p.account_id = a.id))`, accountID).Scan(&on, &ok)
	return !on || ok, err
}

func (st Store) Settings(ctx context.Context, email, accountID string) (SettingsPage, error) {
	p := SettingsPage{Audit: []AuditEntry{}, Countries: []CountryCount{}}
	if !st.ceo(email) {
		return p, ErrForbidden
	}
	var err error
	if p.Values, err = st.Platform(ctx); err != nil {
		return p, err
	}
	rows, err := st.DB.Query(ctx, `SELECT actor, key, old_value, new_value, at FROM settings_audit ORDER BY at DESC LIMIT 50`)
	if err != nil {
		return p, err
	}
	if p.Audit, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (AuditEntry, error) {
		var e AuditEntry
		return e, r.Scan(&e.Actor, &e.Key, &e.Old, &e.New, &e.At)
	}); err != nil {
		return p, err
	}
	rows, err = st.DB.Query(ctx, `SELECT country, count(*)::int FROM accounts a WHERE `+reachable+` AND country IS NOT NULL GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 8`)
	if err != nil {
		return p, err
	}
	if p.Countries, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (CountryCount, error) {
		var c CountryCount
		return c, r.Scan(&c.Country, &c.Members)
	}); err != nil {
		return p, err
	}
	err = st.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM accounts a WHERE a.id = $1 AND a.face_verified_at IS NOT NULL AND EXISTS (SELECT 1 FROM passkeys p WHERE p.account_id = a.id))`, accountID).Scan(&p.Strong)
	return p, err
}

// SetSetting changes one switch. Turning "strong" on needs the CEO's own passkey and face check
// first, so the CEO cannot lock themself out.
func (st Store) SetSetting(ctx context.Context, email, accountID, key string, value any) error {
	if !st.ceo(email) {
		return ErrForbidden
	}
	def, known := SettingDefaults[key]
	if !known {
		return fmt.Errorf("%w: no such setting", ErrBadInput)
	}
	switch def.(type) {
	case bool:
		if _, ok := value.(bool); !ok {
			return fmt.Errorf("%w: on or off", ErrBadInput)
		}
	case string:
		s, ok := value.(string)
		if !ok {
			return fmt.Errorf("%w: text expected", ErrBadInput)
		}
		s = strings.TrimSpace(s)
		if a, err := mail.ParseAddress(s); err != nil || a.Address != s || len(s) > 120 {
			return fmt.Errorf("%w: a valid email address", ErrBadInput)
		}
		value = s
	}
	if key == "sec.strong" && value == true {
		p, err := st.Settings(ctx, email, accountID)
		if err != nil {
			return err
		}
		if !p.Strong {
			return fmt.Errorf("%w: add a passkey and finish your face check first, or you would lock yourself out", ErrBadInput)
		}
	}
	raw, _ := json.Marshal(value)
	tx, err := st.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var old []byte
	err = tx.QueryRow(ctx, `SELECT value FROM platform_settings WHERE key = $1 FOR UPDATE`, key).Scan(&old)
	if err == pgx.ErrNoRows {
		old, _ = json.Marshal(def)
	} else if err != nil {
		return err
	}
	if string(old) == string(raw) {
		return nil
	}
	if _, err := tx.Exec(ctx, `INSERT INTO platform_settings (key, value, updated_by) VALUES ($1, $2, $3)
	  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`, key, raw, strings.ToLower(email)); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO settings_audit (actor, key, old_value, new_value) VALUES ($1, $2, $3, $4)`, strings.ToLower(email), key, old, raw); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
