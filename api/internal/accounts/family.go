package accounts

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Family profiles (Figma 89:1020). The account owner is always the first profile and is not
// stored; up to five more can be added. Kids profiles see films up to their rating, can have
// chat off, need a parent to approve purchases, and can have screen time and a bedtime.
// A parent PIN guards leaving a kids profile and changing its controls.

const MaxProfiles = 6 // including the owner

var (
	ErrTooManyProfiles = errors.New("an account can have up to 6 profiles")
	ErrNeedParentPIN   = errors.New("set a parent PIN first")
	ErrBadParentPIN    = errors.New("that parent PIN is not right")
	ErrParentPaused    = errors.New("too many wrong PINs; try again in 30 minutes")
	ErrBedtime         = errors.New("it is past bedtime for this profile")
	ErrScreenTime      = errors.New("today's screen time for this profile is used up")
)

// Ratings from the catalog mapped to the youngest age that may see them.
var ratingAge = map[string]int{"G": 0, "U": 0, "PG": 7, "PG-13": 12, "12A": 12, "15": 16, "16": 16, "R": 16, "18+": 18, "18": 18}
var maxAge = map[string]int{"all": 0, "7": 7, "12": 12, "16": 16, "18": 18}
var bedtimeRe = regexp.MustCompile(`^([01][0-9]|2[0-3]):[0-5][0-9]$`)

// Allowed says whether a film with this rating is fine under a profile's maximum.
func Allowed(rating, max string) bool {
	age, ok := ratingAge[strings.ToUpper(strings.TrimSpace(rating))]
	if !ok {
		age = 18 // unknown ratings are treated as adult
	}
	return age <= maxAge[max]
}

type Member struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Kind          string `json:"kind"` // owner, adult or kids
	Age           int    `json:"age,omitempty"`
	MaxRating     string `json:"maxRating"`
	Chat          bool   `json:"chat"`
	AskToBuy      bool   `json:"askToBuy"`
	ScreenMinutes int    `json:"screenMinutes"`
	Bedtime       string `json:"bedtime"`
	AIFilter      bool   `json:"aiFilter"`
	WatchedToday  int    `json:"watchedToday"` // seconds
}

type Family struct {
	Profiles  []Member `json:"profiles"`
	PINSet    bool      `json:"pinSet"`
	Requests  []Request `json:"requests"`
	OwnerName string    `json:"ownerName"`
	Adult     bool      `json:"adult"` // owner passed the 18+ check
}

type Request struct {
	ID        string    `json:"id"`
	ProfileID string    `json:"profileId"`
	Member   string    `json:"profile"`
	What      string    `json:"what"`
	Link      string    `json:"link"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
}

const profileCols = `p.id, p.name, p.kind, coalesce(p.age, 0), p.max_rating, p.chat, p.ask_to_buy, p.screen_minutes, p.bedtime, p.ai_filter,
  coalesce((SELECT seconds FROM profile_watch w WHERE w.profile_id = p.id AND w.day = (now() AT TIME ZONE 'Africa/Lagos')::date), 0)`

func scanMember(r pgx.Row) (Member, error) {
	var p Member
	err := r.Scan(&p.ID, &p.Name, &p.Kind, &p.Age, &p.MaxRating, &p.Chat, &p.AskToBuy, &p.ScreenMinutes, &p.Bedtime, &p.AIFilter, &p.WatchedToday)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, ErrNotFound
	}
	return p, err
}

// Family lists the owner and every other profile, with open purchase requests.
func (s Store) Family(ctx context.Context, accountID string) (Family, error) {
	var f Family
	var hash *string
	if err := s.DB.QueryRow(ctx, `SELECT name, parent_pin_hash, (id_verified_at IS NOT NULL AND face_verified_at IS NOT NULL) FROM accounts WHERE id = $1`, accountID).Scan(&f.OwnerName, &hash, &f.Adult); err != nil {
		return f, err
	}
	f.PINSet = hash != nil
	f.Profiles = []Member{{ID: "owner", Name: f.OwnerName, Kind: "owner", MaxRating: "18", Chat: true}}
	rows, err := s.DB.Query(ctx, `SELECT `+profileCols+` FROM profiles p WHERE p.account_id = $1 ORDER BY p.created_at`, accountID)
	if err != nil {
		return f, err
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Member, error) { return scanMember(r) })
	if err != nil {
		return f, err
	}
	f.Profiles = append(f.Profiles, list...)
	rows, err = s.DB.Query(ctx, `SELECT r.id, r.profile_id, p.name, r.what, r.link, r.status, r.created_at FROM kids_requests r JOIN profiles p ON p.id = r.profile_id
	  WHERE r.account_id = $1 AND (r.status = 'pending' OR r.created_at > now() - interval '7 days') ORDER BY r.created_at DESC LIMIT 30`, accountID)
	if err != nil {
		return f, err
	}
	f.Requests, err = pgx.CollectRows(rows, pgx.RowToStructByPos[Request])
	return f, err
}

// ProfileFor returns one of the account's profiles; "owner" or "" is the owner.
func (s Store) ProfileFor(ctx context.Context, accountID, id string) (Member, error) {
	if id == "" || id == "owner" {
		var name string
		if err := s.DB.QueryRow(ctx, `SELECT name FROM accounts WHERE id = $1`, accountID).Scan(&name); err != nil {
			return Member{}, err
		}
		return Member{ID: "owner", Name: name, Kind: "owner", MaxRating: "18", Chat: true}, nil
	}
	if !uuidRe.MatchString(id) {
		return Member{}, ErrNotFound
	}
	return scanMember(s.DB.QueryRow(ctx, `SELECT `+profileCols+` FROM profiles p WHERE p.id = $1 AND p.account_id = $2`, id, accountID))
}

var uuidRe = regexp.MustCompile(`^[0-9a-f-]{36}$`)

func cleanMember(p Member) (Member, error) {
	p.Name = strings.TrimSpace(p.Name)
	if p.Name == "" || len([]rune(p.Name)) > 30 {
		return p, fmt.Errorf("%w: a profile name is 1 to 30 letters", ErrBadInput)
	}
	if p.Kind != "adult" && p.Kind != "kids" {
		return p, fmt.Errorf("%w: choose adult or kids", ErrBadInput)
	}
	if p.Kind == "adult" {
		p.MaxRating = "18"
	}
	if _, ok := maxAge[p.MaxRating]; !ok {
		return p, fmt.Errorf("%w: choose an age rating", ErrBadInput)
	}
	if p.Bedtime != "" && !bedtimeRe.MatchString(p.Bedtime) {
		return p, fmt.Errorf("%w: bedtime looks like 20:00", ErrBadInput)
	}
	if p.ScreenMinutes < 0 || p.ScreenMinutes > 1440 {
		return p, fmt.Errorf("%w: screen time is up to 24 hours", ErrBadInput)
	}
	if p.Kind == "kids" {
		if p.Age < 1 || p.Age > 17 {
			return p, fmt.Errorf("%w: a kids profile needs an age from 1 to 17", ErrBadInput)
		}
		if p.MaxRating == "18" {
			p.MaxRating = "16" // 18+ stays locked for kids whatever the form says
		}
	} else {
		p.Age, p.MaxRating, p.Chat, p.AskToBuy, p.ScreenMinutes, p.Bedtime, p.AIFilter = 0, "18", true, false, 0, "", false
	}
	return p, nil
}

// AddProfile adds a profile. Kids profiles need a parent PIN set first.
func (s Store) AddProfile(ctx context.Context, accountID string, p Member) (Member, error) {
	p, err := cleanMember(p)
	if err != nil {
		return p, err
	}
	if p.Kind == "kids" {
		var hash *string
		if err := s.DB.QueryRow(ctx, `SELECT parent_pin_hash FROM accounts WHERE id = $1`, accountID).Scan(&hash); err != nil {
			return p, err
		}
		if hash == nil {
			return p, ErrNeedParentPIN
		}
	}
	var n int
	if err := s.DB.QueryRow(ctx, `SELECT count(*) FROM profiles WHERE account_id = $1`, accountID).Scan(&n); err != nil {
		return p, err
	}
	if n+1 >= MaxProfiles {
		return p, ErrTooManyProfiles
	}
	var id string
	err = s.DB.QueryRow(ctx, `INSERT INTO profiles (account_id, name, kind, age, max_rating, chat, ask_to_buy, screen_minutes, bedtime, ai_filter)
	  VALUES ($1, $2, $3, nullif($4, 0), $5, $6, $7, $8, $9, $10) RETURNING id`,
		accountID, p.Name, p.Kind, p.Age, p.MaxRating, p.Chat, p.AskToBuy, p.ScreenMinutes, p.Bedtime, p.AIFilter).Scan(&id)
	if err != nil {
		return p, err
	}
	return s.ProfileFor(ctx, accountID, id)
}

// UpdateProfile changes a profile's name and controls; the caller has checked the parent PIN
// when the profile is a kids profile.
func (s Store) UpdateProfile(ctx context.Context, accountID string, p Member) (Member, error) {
	cur, err := s.ProfileFor(ctx, accountID, p.ID)
	if err != nil || cur.Kind == "owner" {
		return cur, ErrNotFound
	}
	if p, err = cleanMember(p); err != nil {
		return p, err
	}
	_, err = s.DB.Exec(ctx, `UPDATE profiles SET name = $3, kind = $4, age = nullif($5, 0), max_rating = $6, chat = $7, ask_to_buy = $8, screen_minutes = $9, bedtime = $10, ai_filter = $11
	  WHERE id = $1 AND account_id = $2`, p.ID, accountID, p.Name, p.Kind, p.Age, p.MaxRating, p.Chat, p.AskToBuy, p.ScreenMinutes, p.Bedtime, p.AIFilter)
	if err != nil {
		return p, err
	}
	return s.ProfileFor(ctx, accountID, p.ID)
}

func (s Store) RemoveProfile(ctx context.Context, accountID, id string) error {
	tag, err := s.DB.Exec(ctx, `DELETE FROM profiles WHERE id = $1 AND account_id = $2`, id, accountID)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

// SetParentPIN sets the PIN. Replacing one needs the current PIN.
func (s Store) SetParentPIN(ctx context.Context, accountID, current, pin string) error {
	if !validPIN(pin) {
		return fmt.Errorf("%w: the PIN is %d to %d digits", ErrBadInput, pinMinLen, pinMaxLen)
	}
	var hash *string
	if err := s.DB.QueryRow(ctx, `SELECT parent_pin_hash FROM accounts WHERE id = $1`, accountID).Scan(&hash); err != nil {
		return err
	}
	if hash != nil {
		if err := s.CheckParentPIN(ctx, accountID, current); err != nil {
			return err
		}
	}
	h, err := hashPassword(pin)
	if err != nil {
		return err
	}
	_, err = s.DB.Exec(ctx, `UPDATE accounts SET parent_pin_hash = $2, parent_pin_tries = 0, parent_pin_paused_until = NULL WHERE id = $1`, accountID, h)
	return err
}

// CheckParentPIN checks the PIN; five wrong tries pause it for 30 minutes.
func (s Store) CheckParentPIN(ctx context.Context, accountID, pin string) error {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var hash *string
	var tries int
	var paused *time.Time
	if err := tx.QueryRow(ctx, `SELECT parent_pin_hash, parent_pin_tries, parent_pin_paused_until FROM accounts WHERE id = $1 FOR UPDATE`, accountID).Scan(&hash, &tries, &paused); err != nil {
		return err
	}
	if hash == nil {
		return ErrNeedParentPIN
	}
	if paused != nil && time.Now().Before(*paused) {
		return ErrParentPaused
	}
	if checkPassword(*hash, pin) {
		if _, err := tx.Exec(ctx, `UPDATE accounts SET parent_pin_tries = 0, parent_pin_paused_until = NULL WHERE id = $1`, accountID); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	tries++
	out := ErrBadParentPIN
	var until *time.Time
	if tries >= PINTries {
		t := time.Now().Add(PINPause)
		until, tries, out = &t, 0, ErrParentPaused
	}
	if _, err := tx.Exec(ctx, `UPDATE accounts SET parent_pin_tries = $2, parent_pin_paused_until = $3 WHERE id = $1`, accountID, tries, until); err != nil {
		return err
	}
	return errors.Join(out, tx.Commit(ctx))
}

// CanWatch says whether a profile may watch now: bedtime in Lagos time and today's screen time.
func CanWatch(p Member, now time.Time) error {
	if p.Kind != "kids" {
		return nil
	}
	if p.ScreenMinutes > 0 && p.WatchedToday >= p.ScreenMinutes*60 {
		return ErrScreenTime
	}
	if p.Bedtime != "" {
		loc, err := time.LoadLocation("Africa/Lagos")
		if err != nil {
			loc = time.FixedZone("WAT", 3600)
		}
		if now.In(loc).Format("15:04") >= p.Bedtime {
			return ErrBedtime
		}
	}
	return nil
}

// AddWatch counts watch time for a profile (capped per call by the caller).
func (s Store) AddWatch(ctx context.Context, profileID string, seconds int) error {
	if seconds <= 0 || seconds > 120 {
		return nil
	}
	_, err := s.DB.Exec(ctx, `INSERT INTO profile_watch (profile_id, day, seconds) VALUES ($1, (now() AT TIME ZONE 'Africa/Lagos')::date, $2)
	  ON CONFLICT (profile_id, day) DO UPDATE SET seconds = profile_watch.seconds + $2`, profileID, seconds)
	return err
}

// AskParent records a kids profile's purchase request for the owner.
func (s Store) AskParent(ctx context.Context, accountID, profileID, what, link string) (Request, error) {
	what = strings.TrimSpace(what)
	if what == "" || len(what) > 120 || len(link) > 300 || (link != "" && !strings.HasPrefix(link, "/")) || strings.HasPrefix(link, "//") {
		return Request{}, fmt.Errorf("%w: say what to buy", ErrBadInput)
	}
	p, err := s.ProfileFor(ctx, accountID, profileID)
	if err != nil {
		return Request{}, err
	}
	if p.Kind != "kids" {
		return Request{}, fmt.Errorf("%w: only kids profiles ask first", ErrBadInput)
	}
	var r Request
	err = s.DB.QueryRow(ctx, `INSERT INTO kids_requests (profile_id, account_id, what, link) VALUES ($1, $2, $3, $4)
	  RETURNING id, profile_id, $5::text, what, link, status, created_at`, profileID, accountID, what, link, p.Name).
		Scan(&r.ID, &r.ProfileID, &r.Member, &r.What, &r.Link, &r.Status, &r.CreatedAt)
	return r, err
}

func (s Store) DecideRequest(ctx context.Context, accountID, id string, approve bool) error {
	status := "declined"
	if approve {
		status = "approved"
	}
	tag, err := s.DB.Exec(ctx, `UPDATE kids_requests SET status = $3, decided_at = now() WHERE id = $1 AND account_id = $2 AND status = 'pending'`, id, accountID, status)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}
