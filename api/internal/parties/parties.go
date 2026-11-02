// Package parties runs watch parties: a host names a group for one premiere, shares a link,
// and friends join. Each member still needs their own seat to enter the watch room.
package parties

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound   = errors.New("watch party not found")
	ErrBadInput   = errors.New("check the party details")
	ErrNotInvited = errors.New("this party is invite only; ask the host to add your email")
	ErrEnded      = errors.New("this premiere has ended")
	ErrHostLeaves = errors.New("the host cannot leave; end the party instead")
	ErrRoomClosed = errors.New("this room is not open to your account")
)

// Rules the host can switch on (Figma "Room rules").
var Rules = map[string]bool{"voice-notes": true, "spoiler-filter": true, "translate-chat": true, "kids-safe": true}

const MaxMembers = 500

type Member struct {
	Name     string    `json:"name"`
	Host     bool      `json:"host"`
	JoinedAt time.Time `json:"joinedAt"`
}

type Party struct {
	ID         string    `json:"id"`
	Code       string    `json:"code"`
	ShowtimeID string    `json:"showtimeId"`
	Film       string    `json:"film"`
	StartsAt   time.Time `json:"startsAt"`
	Name       string    `json:"name"`
	Visibility string    `json:"visibility"`
	Rules      []string  `json:"rules"`
	HostName   string    `json:"hostName"`
	Members    int       `json:"members"`
	IsHost     bool      `json:"isHost"`
	Joined     bool      `json:"joined"`
	Room       string    `json:"room,omitempty"`    // the room type's name
	Seats      int       `json:"seats"`             // how many people fit
	Invited    []string  `json:"invited,omitempty"` // host only
	People     []Member  `json:"people,omitempty"`
}

type Store struct{ DB *pgxpool.Pool }

type New struct {
	ShowtimeID string   `json:"showtimeId"`
	Name       string   `json:"name"`
	Visibility string   `json:"visibility"`
	Rules      []string `json:"rules"`
	Invite     []string `json:"invite"`
	Room       string   `json:"room"` // a live party or private room type; empty for the standard watch party
}

var emailRe = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

func slug(name string) string {
	var b strings.Builder
	dash := false
	for _, r := range strings.ToLower(name) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			dash = false
		} else if !dash && b.Len() > 0 {
			b.WriteByte('-')
			dash = true
		}
		if b.Len() >= 24 {
			break
		}
	}
	return strings.Trim(b.String(), "-")
}

// code is a readable, unguessable link name: tolus-party-k3f9q2.
func code(name string) string {
	const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
	buf := make([]byte, 6)
	_, _ = rand.Read(buf)
	for i := range buf {
		buf[i] = alphabet[int(buf[i])%len(alphabet)]
	}
	if s := slug(name); s != "" {
		return s + "-" + string(buf)
	}
	return "party-" + string(buf)
}

func cleanInvites(list []string) ([]string, error) {
	seen := map[string]bool{}
	out := []string{}
	for _, e := range list {
		e = strings.ToLower(strings.TrimSpace(e))
		if e == "" || seen[e] {
			continue
		}
		if !emailRe.MatchString(e) || len(e) > 200 {
			return nil, fmt.Errorf("%w: %q is not an email address", ErrBadInput, e)
		}
		seen[e] = true
		out = append(out, e)
	}
	if len(out) > 50 {
		return nil, fmt.Errorf("%w: invite up to 50 people at a time", ErrBadInput)
	}
	return out, nil
}

// Create makes a party for a premiere that has not ended and puts the host in it.
func (s Store) Create(ctx context.Context, hostID string, n New) (Party, error) {
	n.Name = strings.TrimSpace(n.Name)
	if c := utf8.RuneCountInString(n.Name); c < 1 || c > 60 {
		return Party{}, fmt.Errorf("%w: give the party a name up to 60 characters", ErrBadInput)
	}
	if n.Visibility != "link" && n.Visibility != "invite" {
		return Party{}, fmt.Errorf("%w: choose who can join", ErrBadInput)
	}
	rules := []string{}
	for _, r := range n.Rules {
		if Rules[r] {
			rules = append(rules, r)
		}
	}
	invites, err := cleanInvites(n.Invite)
	if err != nil {
		return Party{}, err
	}
	var room any
	if n.Room != "" {
		r, err := s.room(ctx, n.Room, hostID)
		if err != nil {
			return Party{}, err
		}
		room = r.ID
		if r.Kind == "private" {
			n.Visibility = "invite"
		}
		if !r.Voice {
			rules = slices.DeleteFunc(rules, func(x string) bool { return x == "voice-notes" })
		}
		if r.Audience == "kids" && !slices.Contains(rules, "kids-safe") {
			rules = append(rules, "kids-safe")
		}
	}
	var id, c string
	err = pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		var ended bool
		if err := tx.QueryRow(ctx, `SELECT starts_at + make_interval(mins => duration_min) < now() FROM showtimes WHERE id = $1`, n.ShowtimeID).Scan(&ended); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if ended {
			return ErrEnded
		}
		c = code(n.Name)
		if err := tx.QueryRow(ctx, `INSERT INTO parties (code, showtime_id, host_id, name, visibility, rules, room_type) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
			c, n.ShowtimeID, hostID, n.Name, n.Visibility, rules, room).Scan(&id); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO party_members (party_id, account_id) VALUES ($1, $2)`, id, hostID); err != nil {
			return err
		}
		for _, e := range invites {
			if _, err := tx.Exec(ctx, `INSERT INTO party_invites (party_id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`, id, e); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return Party{}, err
	}
	return s.Get(ctx, c, hostID)
}

const selectParty = `SELECT p.id, p.code, p.showtime_id, st.film, st.starts_at, p.name, p.visibility, p.rules, h.name,
  (SELECT count(*) FROM party_members m WHERE m.party_id = p.id),
  p.host_id = $2,
  EXISTS (SELECT 1 FROM party_members m WHERE m.party_id = p.id AND m.account_id::text = $2::text),
  coalesce(rt.name, ''), coalesce(rt.seats, 500)
  FROM parties p JOIN showtimes st ON st.id = p.showtime_id JOIN accounts h ON h.id = p.host_id LEFT JOIN room_types rt ON rt.id = p.room_type`

func scan(row pgx.Row) (Party, error) {
	var p Party
	err := row.Scan(&p.ID, &p.Code, &p.ShowtimeID, &p.Film, &p.StartsAt, &p.Name, &p.Visibility, &p.Rules, &p.HostName, &p.Members, &p.IsHost, &p.Joined, &p.Room, &p.Seats)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, ErrNotFound
	}
	return p, err
}

// Get loads a party by its link code, with the member list for members and the invite list for the host.
func (s Store) Get(ctx context.Context, code, viewerID string) (Party, error) {
	p, err := scan(s.DB.QueryRow(ctx, selectParty+` WHERE p.code = $1`, code, nullable(viewerID)))
	if err != nil {
		return p, err
	}
	rows, err := s.DB.Query(ctx, `SELECT a.name, m.account_id = p.host_id, m.joined_at FROM party_members m
	  JOIN accounts a ON a.id = m.account_id JOIN parties p ON p.id = m.party_id
	  WHERE m.party_id = $1 ORDER BY m.account_id = p.host_id DESC, m.joined_at LIMIT 60`, p.ID)
	if err != nil {
		return p, err
	}
	p.People, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Member, error) {
		var m Member
		err := r.Scan(&m.Name, &m.Host, &m.JoinedAt)
		return m, err
	})
	if err != nil {
		return p, err
	}
	if p.IsHost {
		rows, err := s.DB.Query(ctx, `SELECT email FROM party_invites WHERE party_id = $1 ORDER BY created_at`, p.ID)
		if err != nil {
			return p, err
		}
		if p.Invited, err = pgx.CollectRows(rows, pgx.RowTo[string]); err != nil {
			return p, err
		}
	}
	return p, nil
}

func nullable(id string) any {
	if id == "" {
		return "00000000-0000-0000-0000-000000000000"
	}
	return id
}

// Join adds the viewer to the party. Invite-only parties need the viewer's email on the list.
func (s Store) Join(ctx context.Context, code, accountID, email string) (Party, error) {
	err := pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		var id, vis, roomID string
		var ended bool
		var n, seats int
		err := tx.QueryRow(ctx, `SELECT p.id, p.visibility, st.starts_at + make_interval(mins => st.duration_min) < now(),
		  (SELECT count(*) FROM party_members m WHERE m.party_id = p.id), coalesce(p.room_type, ''),
		  coalesce((SELECT seats FROM room_types WHERE id = p.room_type), $2)
		  FROM parties p JOIN showtimes st ON st.id = p.showtime_id WHERE p.code = $1 FOR UPDATE OF p`, code, MaxMembers).Scan(&id, &vis, &ended, &n, &roomID, &seats)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if ended {
			return ErrEnded
		}
		var member bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM party_members WHERE party_id = $1 AND account_id = $2)`, id, accountID).Scan(&member); err != nil {
			return err
		}
		if member {
			return nil
		}
		if n >= min(seats, MaxMembers) {
			return fmt.Errorf("%w: this party is full", ErrBadInput)
		}
		if roomID != "" {
			var aud string
			if err := tx.QueryRow(ctx, `SELECT audience FROM room_types WHERE id = $1`, roomID).Scan(&aud); err != nil {
				return err
			}
			if ok, err := audienceOK(ctx, tx, aud, accountID); err != nil {
				return err
			} else if !ok {
				return ErrRoomClosed
			}
		}
		if vis == "invite" {
			var ok bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM party_invites WHERE party_id = $1 AND email = lower($2))
			  OR EXISTS (SELECT 1 FROM party_members WHERE party_id = $1 AND account_id = $3)`, id, email, accountID).Scan(&ok); err != nil {
				return err
			}
			if !ok {
				return ErrNotInvited
			}
		}
		_, err = tx.Exec(ctx, `INSERT INTO party_members (party_id, account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, id, accountID)
		return err
	})
	if err != nil {
		return Party{}, err
	}
	return s.Get(ctx, code, accountID)
}

// Leave takes a member out. Hosts end the party instead.
func (s Store) Leave(ctx context.Context, code, accountID string) error {
	var isHost bool
	err := s.DB.QueryRow(ctx, `SELECT host_id = $2 FROM parties WHERE code = $1`, code, accountID).Scan(&isHost)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if isHost {
		return ErrHostLeaves
	}
	_, err = s.DB.Exec(ctx, `DELETE FROM party_members WHERE account_id = $2 AND party_id = (SELECT id FROM parties WHERE code = $1)`, code, accountID)
	return err
}

// End deletes a party; only its host may.
func (s Store) End(ctx context.Context, code, accountID string) error {
	tag, err := s.DB.Exec(ctx, `DELETE FROM parties WHERE code = $1 AND host_id = $2`, code, accountID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Invite adds emails to an invite list; only the host may.
func (s Store) Invite(ctx context.Context, code, hostID string, emails []string) (Party, error) {
	list, err := cleanInvites(emails)
	if err != nil {
		return Party{}, err
	}
	var id string
	if err := s.DB.QueryRow(ctx, `SELECT id FROM parties WHERE code = $1 AND host_id = $2`, code, hostID).Scan(&id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Party{}, ErrNotFound
		}
		return Party{}, err
	}
	for _, e := range list {
		if _, err := s.DB.Exec(ctx, `INSERT INTO party_invites (party_id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`, id, e); err != nil {
			return Party{}, err
		}
	}
	return s.Get(ctx, code, hostID)
}

// ForViewer lists parties for premieres that have not ended: the viewer's own first, then open
// (link) parties with the most people, so the home row shows where the crowd is.
func (s Store) ForViewer(ctx context.Context, accountID string, limit int) ([]Party, error) {
	rows, err := s.DB.Query(ctx, selectParty+`
	  WHERE st.starts_at + make_interval(mins => st.duration_min) > now()
	    AND (p.visibility = 'link' OR EXISTS (SELECT 1 FROM party_members m WHERE m.party_id = p.id AND m.account_id::text = $2::text))
	  ORDER BY EXISTS (SELECT 1 FROM party_members m WHERE m.party_id = p.id AND m.account_id::text = $2::text) DESC,
	    (SELECT count(*) FROM party_members m WHERE m.party_id = p.id) DESC, st.starts_at
	  LIMIT $1`, limit, nullable(accountID))
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Party, error) { return scan(r) })
}
