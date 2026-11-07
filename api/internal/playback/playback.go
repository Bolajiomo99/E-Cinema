// Package playback keeps what the player reports each minute: how far into the film each viewer
// got, where and when they watched, and how well the stream held up (drift from the room clock,
// stalls, time to first frame). It feeds the studio control room and analytics and the
// executive Live and Infrastructure pages.
package playback

import (
	"context"
	"errors"
	"math"
	"regexp"
	"slices"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// InSyncMs is how close to the room clock a viewer must be to count as in sync.
const InSyncMs = 250

var (
	ErrBadInput = errors.New("bad player report")
	Devices     = []string{"android", "ios", "web", "tv", "tablet", "vr"}
)

type Store struct{ DB *pgxpool.Pool }

// Report is one minute of a player's state.
type Report struct {
	Position float64 `json:"position"` // seconds into the film
	DriftMs  int     `json:"driftMs"`  // median distance from the room clock this minute
	StallMs  int     `json:"stallMs"`  // time spent waiting for data this minute
	Stalls   int     `json:"stalls"`
	StartMs  int     `json:"startMs"` // join to first frame, sent once
	Device   string  `json:"device"`
	Hour     int     `json:"hour"` // the viewer's local hour and weekday (0 is Monday)
	Dow      int     `json:"dow"`
}

func clamp(v, lo, hi int) int { return max(lo, min(hi, v)) }

// Record stores one report. Rooms add to the per-minute quality totals; rooms and replays
// both move the viewer's progress on. A report without a device is ignored (older players).
func (s Store) Record(ctx context.Context, accountID, showtimeID, mode string, r Report, now time.Time) error {
	if r.Device == "" {
		return nil
	}
	if !slices.Contains(Devices, r.Device) || r.Hour < 0 || r.Hour > 23 || r.Dow < 0 || r.Dow > 6 || math.IsNaN(r.Position) || r.Position < 0 {
		return ErrBadInput
	}
	if mode != "room" && mode != "replay" {
		return nil
	}
	pos := clamp(int(r.Position), 0, 86400)
	var start *int
	if r.StartMs > 0 {
		v := clamp(r.StartMs, 1, 120000)
		start = &v
	}
	if _, err := s.DB.Exec(ctx, `INSERT INTO watch_progress (account_id, showtime_id, device, local_hour, local_dow, start_ms, max_pos, first_at, updated_at)
	  SELECT $1, id, $3, $4, $5, $6, $7, $8, $8 FROM showtimes WHERE id = $2
	  ON CONFLICT (account_id, showtime_id) DO UPDATE SET max_pos = greatest(watch_progress.max_pos, EXCLUDED.max_pos),
	    start_ms = coalesce(watch_progress.start_ms, EXCLUDED.start_ms), updated_at = EXCLUDED.updated_at`,
		accountID, showtimeID, r.Device, r.Hour, r.Dow, start, pos, now); err != nil {
		return err
	}
	if mode != "room" {
		return nil
	}
	drift := clamp(r.DriftMs, 0, 10000)
	stall := clamp(r.StallMs, 0, 60000)
	inSync, stalled := 0, 0
	if drift <= InSyncMs {
		inSync = 1
	}
	if stall > 0 || r.Stalls > 0 {
		stalled = 1
	}
	_, err := s.DB.Exec(ctx, `INSERT INTO playback_minutes (showtime_id, minute, country, beats, in_sync, stalled_beats, stall_ms, drift_ms)
	  SELECT id, date_trunc('minute', $2::timestamptz), coalesce((SELECT nullif(country, '') FROM accounts WHERE id = $3), ''), 1, $4, $5, $6, $7 FROM showtimes WHERE id = $1
	  ON CONFLICT (showtime_id, minute, country) DO UPDATE SET beats = playback_minutes.beats + 1, in_sync = playback_minutes.in_sync + EXCLUDED.in_sync,
	    stalled_beats = playback_minutes.stalled_beats + EXCLUDED.stalled_beats, stall_ms = playback_minutes.stall_ms + EXCLUDED.stall_ms,
	    drift_ms = playback_minutes.drift_ms + EXCLUDED.drift_ms`,
		showtimeID, now, accountID, inSync, stalled, stall, drift)
	return err
}

// Quality is how the stream held up. Nil fields mean no reports yet.
type Quality struct {
	Reports    int                `json:"reports"`
	InSync     *float64           `json:"inSync"`     // share of reports within ±250 ms
	Rebuffer   *float64           `json:"rebuffer"`   // share of watch time spent stalled
	DriftMs    *int               `json:"driftMs"`    // average drift
	StartMs    *int               `json:"startMs"`    // average join to first frame
	StartP95Ms *int               `json:"startP95Ms"` // 95th percentile
	Countries  map[string]Country `json:"countries,omitempty"`
}

type Country struct {
	Reports int `json:"reports"`
	DriftMs int `json:"driftMs"`
}

func ratio(a, b int64) *float64 {
	if b <= 0 {
		return nil
	}
	v := float64(a) / float64(b)
	return &v
}

// Of reads quality from reports since the given time, for one showtime ("" for every room).
// Start times come from viewers who joined in the same window.
func (s Store) Of(ctx context.Context, showtimeID string, since time.Time) (Quality, error) {
	q := Quality{}
	var beats, inSync, stallMs, drift int64
	if err := s.DB.QueryRow(ctx, `SELECT coalesce(sum(beats), 0), coalesce(sum(in_sync), 0), coalesce(sum(stall_ms), 0), coalesce(sum(drift_ms), 0)
	  FROM playback_minutes WHERE minute >= date_trunc('minute', $2::timestamptz) AND ($1 = '' OR showtime_id = $1)`, showtimeID, since).Scan(&beats, &inSync, &stallMs, &drift); err != nil {
		return q, err
	}
	q.Reports = int(beats)
	q.InSync = ratio(inSync, beats)
	q.Rebuffer = ratio(stallMs, beats*60000)
	if beats > 0 {
		d := int(drift / beats)
		q.DriftMs = &d
	}
	var avg, p95 *float64
	if err := s.DB.QueryRow(ctx, `SELECT avg(start_ms)::float8, percentile_cont(0.95) WITHIN GROUP (ORDER BY start_ms)::float8
	  FROM watch_progress WHERE start_ms IS NOT NULL AND first_at >= $2 AND ($1 = '' OR showtime_id = $1)`, showtimeID, since).Scan(&avg, &p95); err != nil {
		return q, err
	}
	if avg != nil {
		v := int(math.Round(*avg))
		q.StartMs = &v
	}
	if p95 != nil {
		v := int(math.Round(*p95))
		q.StartP95Ms = &v
	}
	if showtimeID == "" {
		return q, nil
	}
	rows, err := s.DB.Query(ctx, `SELECT country, sum(beats)::int, (sum(drift_ms) / greatest(sum(beats), 1))::int FROM playback_minutes
	  WHERE showtime_id = $1 AND minute >= date_trunc('minute', $2::timestamptz) AND country <> '' GROUP BY country`, showtimeID, since)
	if err != nil {
		return q, err
	}
	defer rows.Close()
	q.Countries = map[string]Country{}
	for rows.Next() {
		var cc string
		var c Country
		if err := rows.Scan(&cc, &c.Reports, &c.DriftMs); err != nil {
			return q, err
		}
		q.Countries[cc] = c
	}
	return q, rows.Err()
}

// Audience is who watched a set of showtimes and how far they got.
type Audience struct {
	Viewers   int            `json:"viewers"`
	Retention []float64      `json:"retention"` // share still watching at 0%, 5% … 100% of the runtime
	Hours     [7][24]int     `json:"hours"`     // viewers by local weekday (Monday first) and hour
	Devices   map[string]int `json:"devices"`
}

// AudienceOf reads progress for showtimes that started in [from, to).
func (s Store) AudienceOf(ctx context.Context, studio string, from, to time.Time) (Audience, error) {
	a := Audience{Retention: make([]float64, 21), Devices: map[string]int{}}
	rows, err := s.DB.Query(ctx, `SELECT w.device, w.local_hour, w.local_dow, w.max_pos::float8 / greatest(t.duration_min * 60, 1)
	  FROM watch_progress w JOIN showtimes t ON t.id = w.showtime_id
	  WHERE t.studio = $1 AND t.starts_at >= $2 AND t.starts_at < $3`, studio, from, to)
	if err != nil {
		return a, err
	}
	defer rows.Close()
	reached := make([]int, 21)
	for rows.Next() {
		var dev string
		var h, d int
		var frac float64
		if err := rows.Scan(&dev, &h, &d, &frac); err != nil {
			return a, err
		}
		a.Viewers++
		a.Devices[dev]++
		a.Hours[d][h]++
		for i := range reached {
			if frac >= float64(i)/20-0.0001 {
				reached[i]++
			}
		}
	}
	if a.Viewers > 0 {
		for i, n := range reached {
			a.Retention[i] = float64(n) / float64(a.Viewers)
		}
	}
	return a, rows.Err()
}

var visitorRe = regexp.MustCompile(`^[0-9a-f]{16,64}$`)
var countryRe = regexp.MustCompile(`^[A-Z]{2}$`)

// View counts one visitor opening a film page ("page") or playing its trailer clip ("clip"),
// once per visitor per film per UTC day. It reports whether the view was new; an unknown
// film or a malformed visitor is ErrBadInput.
func (s Store) View(ctx context.Context, showtimeID, kind, visitor, country string, now time.Time) (bool, error) {
	if (kind != "page" && kind != "clip") || !visitorRe.MatchString(visitor) || showtimeID == "" {
		return false, ErrBadInput
	}
	var c *string
	if countryRe.MatchString(country) {
		c = &country
	}
	tag, err := s.DB.Exec(ctx, `INSERT INTO page_views (day, showtime_id, kind, visitor, country)
	  SELECT $1::date, id, $3, $4, $5 FROM showtimes WHERE id = $2
	  ON CONFLICT DO NOTHING`, now.UTC().Format("2006-01-02"), showtimeID, kind, visitor, c)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}
