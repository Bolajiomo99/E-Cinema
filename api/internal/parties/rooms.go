package parties

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// Room types published on the executive "Rooms and VR halls" page (Figma 83:831).
type Room struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Kind     string `json:"kind"`
	Scene    string `json:"scene"`
	Seats    int    `json:"seats"`
	Audience string `json:"audience"`
	Voice    bool   `json:"voice"`
	Spatial  bool   `json:"spatial"`
	Avatars  bool   `json:"avatars"`
}

type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// audienceOK: VIP rooms need an active VIP or Enterprise plan, 18+ rooms a checked ID and face.
func audienceOK(ctx context.Context, q querier, audience, accountID string) (bool, error) {
	switch audience {
	case "vip":
		var ok bool
		err := q.QueryRow(ctx, `SELECT plan IN ('vip', 'enterprise') AND plan_status = 'active' FROM accounts WHERE id = $1`, accountID).Scan(&ok)
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return ok, err
	case "adult":
		var ok bool
		err := q.QueryRow(ctx, `SELECT id_verified_at IS NOT NULL AND face_verified_at IS NOT NULL FROM accounts WHERE id = $1`, accountID).Scan(&ok)
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return ok, err
	}
	return true, nil
}

// Rooms lists the live room types of the given kinds this viewer may enter.
func (s Store) Rooms(ctx context.Context, accountID string, kinds ...string) ([]Room, error) {
	rows, err := s.DB.Query(ctx, `SELECT id, name, kind, scene, seats, audience, voice, spatial, avatars FROM room_types
	  WHERE live AND kind = ANY($1) ORDER BY sort, name`, kinds)
	if err != nil {
		return nil, err
	}
	all, err := pgx.CollectRows(rows, pgx.RowToStructByPos[Room])
	if err != nil {
		return nil, err
	}
	out := []Room{}
	for _, r := range all {
		ok, err := audienceOK(ctx, s.DB, r.Audience, accountID)
		if err != nil {
			return nil, err
		}
		if ok {
			out = append(out, r)
		}
	}
	return out, nil
}

func (s Store) room(ctx context.Context, id, accountID string) (Room, error) {
	var r Room
	err := s.DB.QueryRow(ctx, `SELECT id, name, kind, scene, seats, audience, voice, spatial, avatars FROM room_types
	  WHERE id = $1 AND live AND kind IN ('party', 'private')`, id).Scan(&r.ID, &r.Name, &r.Kind, &r.Scene, &r.Seats, &r.Audience, &r.Voice, &r.Spatial, &r.Avatars)
	if errors.Is(err, pgx.ErrNoRows) {
		return r, fmt.Errorf("%w: that room is not open", ErrBadInput)
	}
	if err != nil {
		return r, err
	}
	if ok, err := audienceOK(ctx, s.DB, r.Audience, accountID); err != nil {
		return r, err
	} else if !ok {
		return r, ErrRoomClosed
	}
	return r, nil
}
