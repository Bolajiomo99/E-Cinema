package rooms

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// The studio's live control room (Figma 37:1272): what the audience of one premiere is doing.
// Studios see counts, reported messages and the most repeated lines, never who is watching.

// Report is a reported world-chat message waiting on (or already handled by) moderation.
type Report struct {
	MessageID int64     `json:"messageId"`
	Name      string    `json:"name"`
	Country   string    `json:"country"`
	Body      string    `json:"body"`
	Kind      string    `json:"kind"`
	Reasons   []string  `json:"reasons"`
	Reporters int       `json:"reporters"`
	Hidden    bool      `json:"hidden"`
	Status    string    `json:"status"` // open | actioned | dismissed
	At        time.Time `json:"at"`
}

// Phrase is a line many people typed in one language.
type Phrase struct {
	Lang  string `json:"lang"`
	Body  string `json:"body"`
	Count int    `json:"count"`
}

// Said is one recent world-chat line, for the audience mood reading.
type Said struct {
	Body string    `json:"body"`
	At   time.Time `json:"at"`
}

type Control struct {
	ShowtimeID  string     `json:"showtimeId"`
	Film        string     `json:"film"`
	StartsAt    time.Time  `json:"startsAt"`
	DurationMin int        `json:"durationMin"`
	PausedAt    *time.Time `json:"pausedAt"` // set while the studio has the premiere paused
	PausedMs    int64      `json:"pausedMs"` // total time spent paused so far
	Messages    int        `json:"messages"`
	Spoilers    int        `json:"spoilers"`
	AutoHidden  int        `json:"autoHidden"`
	Reports     []Report   `json:"reports"`
	Phrases     []Phrase   `json:"phrases"`
	Recent      []Said     `json:"recent"`
}

func (st Store) Control(ctx context.Context, showtimeID string) (Control, error) {
	c := Control{ShowtimeID: showtimeID}
	err := st.DB.QueryRow(ctx, `SELECT film, starts_at, duration_min, paused_at, paused_ms FROM showtimes WHERE id = $1`, showtimeID).Scan(&c.Film, &c.StartsAt, &c.DurationMin, &c.PausedAt, &c.PausedMs)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, ErrNoMessage
	}
	if err != nil {
		return c, err
	}
	if err := st.DB.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE spoiler),
	    count(*) FILTER (WHERE hidden AND NOT EXISTS (SELECT 1 FROM room_reports r WHERE r.message_id = m.id AND r.status <> 'open'))
	  FROM room_messages m WHERE showtime_id = $1 AND party_id IS NULL`, showtimeID).Scan(&c.Messages, &c.Spoilers, &c.AutoHidden); err != nil {
		return c, err
	}
	rows, err := st.DB.Query(ctx, `SELECT m.id, m.name, m.country, m.body, m.kind, array_agg(DISTINCT r.reason ORDER BY r.reason), count(DISTINCT r.reporter_id), m.hidden,
	    CASE WHEN bool_or(r.status = 'open') THEN 'open' WHEN bool_or(r.status = 'actioned') THEN 'actioned' ELSE 'dismissed' END, max(r.created_at)
	  FROM room_reports r JOIN room_messages m ON m.id = r.message_id
	  WHERE r.showtime_id = $1 AND m.party_id IS NULL
	  GROUP BY m.id ORDER BY bool_or(r.status = 'open') DESC, max(r.created_at) DESC LIMIT 30`, showtimeID)
	if err != nil {
		return c, err
	}
	c.Reports, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Report, error) {
		var x Report
		err := r.Scan(&x.MessageID, &x.Name, &x.Country, &x.Body, &x.Kind, &x.Reasons, &x.Reporters, &x.Hidden, &x.Status, &x.At)
		return x, err
	})
	if err != nil {
		return c, err
	}
	// The line each language repeated most, counted case-blind, at least three times.
	rows, err = st.DB.Query(ctx, `SELECT lang, body, n FROM (
	    SELECT lang, min(body) AS body, count(DISTINCT account_id) AS n, row_number() OVER (PARTITION BY lang ORDER BY count(DISTINCT account_id) DESC, min(id)) AS k
	    FROM room_messages WHERE showtime_id = $1 AND party_id IS NULL AND NOT hidden AND NOT spoiler AND kind = 'text' AND lang <> '' AND char_length(body) <= 60
	    GROUP BY lang, lower(trim(body))) t
	  WHERE k = 1 AND n >= 3 ORDER BY n DESC LIMIT 6`, showtimeID)
	if err != nil {
		return c, err
	}
	c.Phrases, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Phrase, error) {
		var p Phrase
		err := r.Scan(&p.Lang, &p.Body, &p.Count)
		return p, err
	})
	if err != nil {
		return c, err
	}
	rows, err = st.DB.Query(ctx, `SELECT body, created_at FROM (SELECT body, created_at, id FROM room_messages
	  WHERE showtime_id = $1 AND party_id IS NULL AND NOT hidden AND kind = 'text' ORDER BY id DESC LIMIT 300) t ORDER BY id`, showtimeID)
	if err != nil {
		return c, err
	}
	c.Recent, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Said, error) {
		var s Said
		err := r.Scan(&s.Body, &s.At)
		return s, err
	})
	return c, err
}

// Moderate settles the reports on a world-chat message: hide it for everyone, or keep it.
// It returns whether the message is hidden now.
func (st Store) Moderate(ctx context.Context, showtimeID string, messageID int64, hide bool) (bool, error) {
	status := "dismissed"
	if hide {
		status = "actioned"
	}
	tag, err := st.DB.Exec(ctx, `UPDATE room_reports SET status = $3 WHERE showtime_id = $1 AND message_id = $2`, showtimeID, messageID, status)
	if err != nil {
		return false, err
	}
	if tag.RowsAffected() == 0 {
		return false, ErrNoMessage
	}
	var hidden bool
	err = st.DB.QueryRow(ctx, `UPDATE room_messages SET hidden = $3 WHERE id = $2 AND showtime_id = $1 RETURNING hidden`, showtimeID, messageID, hide).Scan(&hidden)
	return hidden, err
}
