package exec

import (
	"context"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// Rooms and VR halls (Figma 83:831). VR and AR halls are what viewers pick in the VR cinema;
// party and private rooms are what a host opens a watch party in. Every hall in the 3D scene
// has six rows of fourteen seats, so VR and AR halls always hold 84.

const HallSeats = 84

type RoomType struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Kind     string `json:"kind"`  // vr, ar, party, private
	Scene    string `json:"scene"` // hall, rooftop, space, living, lounge
	Seats    int    `json:"seats"`
	Audience string `json:"audience"` // everyone, vip, adult, kids
	Voice    bool   `json:"voice"`
	Spatial  bool   `json:"spatial"`
	Avatars  bool   `json:"avatars"`
	Live     bool   `json:"live"`
	Parties  int    `json:"parties"` // watch parties opened in it this month
}

type Rooms struct {
	Types     []RoomType `json:"types"`
	VRSeats   int        `json:"vrSeats"`  // VR seats sold this month
	Parties   int        `json:"parties"`  // watch parties opened this month
	AvgParty  float64    `json:"avgParty"` // people per party this month
	CanAdd    bool       `json:"canAdd"`
	UpdatedBy string     `json:"updatedBy"` // who changed a room last
	UpdatedAt *time.Time `json:"updatedAt"`
}

var (
	roomKinds  = map[string]bool{"vr": true, "ar": true, "party": true, "private": true}
	roomAud    = map[string]bool{"everyone": true, "vip": true, "adult": true, "kids": true}
	kindScenes = map[string]map[string]bool{
		"vr": {"hall": true, "rooftop": true, "space": true}, "ar": {"living": true},
		"party": {"lounge": true}, "private": {"lounge": true},
	}
)

func monthStart(now time.Time) time.Time {
	lagos := time.FixedZone("WAT", 3600)
	l := now.In(lagos)
	return time.Date(l.Year(), l.Month(), 1, 0, 0, 0, 0, lagos)
}

func (st Store) Rooms(ctx context.Context, email string, now time.Time) (Rooms, error) {
	r := Rooms{Types: []RoomType{}}
	if err := st.allowed(ctx, email, "coo", "cfo"); err != nil {
		return r, err
	}
	var err error
	if r.CanAdd, err = st.CanAddProducts(ctx, email); err != nil {
		return r, err
	}
	from := monthStart(now)
	rows, err := st.DB.Query(ctx, `SELECT t.id, t.name, t.kind, t.scene, t.seats, t.audience, t.voice, t.spatial, t.avatars, t.live,
	    (SELECT count(*)::int FROM parties p WHERE coalesce(p.room_type, 'watch-party') = t.id AND p.created_at >= $1)
	  FROM room_types t ORDER BY t.live DESC, t.sort, t.name`, from)
	if err != nil {
		return r, err
	}
	if r.Types, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (RoomType, error) {
		var t RoomType
		err := row.Scan(&t.ID, &t.Name, &t.Kind, &t.Scene, &t.Seats, &t.Audience, &t.Voice, &t.Spatial, &t.Avatars, &t.Live, &t.Parties)
		return t, err
	}); err != nil {
		return r, err
	}
	if err := st.DB.QueryRow(ctx, `SELECT coalesce(sum(seats), 0)::int FROM holds WHERE status = 'paid' AND quality = 'vr' AND created_at >= $1`, from).Scan(&r.VRSeats); err != nil {
		return r, err
	}
	if err := st.DB.QueryRow(ctx, `SELECT count(*)::int, coalesce(avg(n), 0)::float8 FROM (SELECT (SELECT count(*) FROM party_members m WHERE m.party_id = p.id) AS n
	  FROM parties p WHERE p.created_at >= $1) x`, from).Scan(&r.Parties, &r.AvgParty); err != nil {
		return r, err
	}
	var by string
	var at time.Time
	err = st.DB.QueryRow(ctx, `SELECT updated_by, updated_at FROM room_types WHERE updated_by <> '' ORDER BY updated_at DESC LIMIT 1`).Scan(&by, &at)
	if err == nil {
		r.UpdatedBy, r.UpdatedAt = by, &at
	} else if err != pgx.ErrNoRows {
		return r, err
	}
	return r, nil
}

// SaveRoom adds a room type (empty ID) or changes one. Only those who may add merch and rooms.
func (st Store) SaveRoom(ctx context.Context, email string, in RoomType) (string, error) {
	ok, err := st.CanAddProducts(ctx, email)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", ErrForbidden
	}
	in.Name = strings.TrimSpace(in.Name)
	if n := utf8.RuneCountInString(in.Name); n < 2 || n > 40 || !roomKinds[in.Kind] || !roomAud[in.Audience] || !kindScenes[in.Kind][in.Scene] {
		return "", ErrBadInput
	}
	if in.Kind == "vr" || in.Kind == "ar" {
		in.Seats = HallSeats
	} else if in.Seats < 2 || in.Seats > 500 {
		return "", ErrBadInput
	}
	if in.Audience == "kids" {
		in.Voice = false // kids rooms never carry voice chat
	}
	if in.ID == "" {
		base := strings.Trim(slugBad.ReplaceAllString(strings.ToLower(in.Name), "-"), "-")
		if len(base) < 2 {
			base = "room"
		}
		if len(base) > 40 {
			base = strings.Trim(base[:40], "-")
		}
		id := base
		for i := 2; ; i++ {
			var taken bool
			if err := st.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM room_types WHERE id = $1)`, id).Scan(&taken); err != nil {
				return "", err
			}
			if !taken {
				break
			}
			id = fmt.Sprintf("%s-%d", base, i)
		}
		_, err = st.DB.Exec(ctx, `INSERT INTO room_types (id, name, kind, scene, seats, audience, voice, spatial, avatars, live, sort, updated_by)
		  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, (SELECT coalesce(max(sort), 0) + 1 FROM room_types), lower($11))`,
			id, in.Name, in.Kind, in.Scene, in.Seats, in.Audience, in.Voice, in.Spatial, in.Avatars, in.Live, email)
		return id, err
	}
	tag, err := st.DB.Exec(ctx, `UPDATE room_types SET name = $2, kind = $3, scene = $4, seats = $5, audience = $6, voice = $7, spatial = $8,
	  avatars = $9, live = $10, updated_by = lower($11), updated_at = now() WHERE id = $1`,
		in.ID, in.Name, in.Kind, in.Scene, in.Seats, in.Audience, in.Voice, in.Spatial, in.Avatars, in.Live, email)
	if err != nil {
		return "", err
	}
	if tag.RowsAffected() == 0 {
		return "", ErrNotFound
	}
	return in.ID, nil
}
