package exec

import (
	"context"
	"time"
)

// Infrastructure (Figma 50:469): what is really running today. One Render region, media on
// Cloudflare R2, and a nightly test-restored database copy on R2.

type Backup struct {
	Key        string    `json:"key"`
	Bytes      int64     `json:"bytes"`
	Tables     int       `json:"tables"`
	Restored   bool      `json:"restored"`
	FinishedAt time.Time `json:"finishedAt"`
}

type Infra struct {
	ViewersNow  int      `json:"viewersNow"` // heartbeats in the last 2 minutes
	PeakToday   int      `json:"peakToday"`  // most accounts watching on one screening today
	DBPingMs    float64  `json:"dbPingMs"`
	DBBytes     int64    `json:"dbBytes"`
	DBConns     int      `json:"dbConns"`
	DBMaxConns  int      `json:"dbMaxConns"`
	DBVersion   string   `json:"dbVersion"`
	Backups     []Backup `json:"backups"`
	Messages24h int      `json:"messages24h"`
	Seats24h    int      `json:"seats24h"`
	// Filled in by the HTTP layer from this instance's own request timer.
	P50Ms    float64 `json:"p50Ms"`
	P99Ms    float64 `json:"p99Ms"`
	Requests int     `json:"requests"`
	Stream   any     `json:"stream"` // player reports over the last 24 hours (filled by the API)
}

func (st Store) Infra(ctx context.Context, email string, now time.Time) (Infra, error) {
	in := Infra{Backups: []Backup{}}
	if err := st.allowed(ctx, email, "cto"); err != nil {
		return in, err
	}
	t := time.Now()
	if err := st.DB.Ping(ctx); err != nil {
		return in, err
	}
	in.DBPingMs = float64(time.Since(t).Microseconds()) / 1000
	lagos := time.FixedZone("WAT", 3600)
	l := now.In(lagos)
	today := time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, lagos)
	if err := st.DB.QueryRow(ctx, `SELECT
	    (SELECT count(*) FROM watch_last WHERE at >= $1)::int,
	    coalesce((SELECT max(n) FROM (SELECT count(DISTINCT account_id) n FROM watch_beats WHERE day = $2::date AND mode = 'room' GROUP BY showtime_id) x), 0)::int,
	    pg_database_size(current_database()),
	    (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database())::int,
	    current_setting('max_connections')::int,
	    split_part(current_setting('server_version'), ' ', 1),
	    (SELECT count(*) FROM room_messages WHERE created_at >= $3)::int,
	    (SELECT count(*) FROM holds WHERE created_at >= $3)::int`,
		now.Add(-2*time.Minute), today, now.Add(-24*time.Hour)).Scan(&in.ViewersNow, &in.PeakToday, &in.DBBytes, &in.DBConns, &in.DBMaxConns, &in.DBVersion, &in.Messages24h, &in.Seats24h); err != nil {
		return in, err
	}
	rows, err := st.DB.Query(ctx, `SELECT object_key, bytes, tables, restored, finished_at FROM infra_backups ORDER BY finished_at DESC LIMIT 7`)
	if err != nil {
		return in, err
	}
	defer rows.Close()
	for rows.Next() {
		var b Backup
		if err := rows.Scan(&b.Key, &b.Bytes, &b.Tables, &b.Restored, &b.FinishedAt); err != nil {
			return in, err
		}
		in.Backups = append(in.Backups, b)
	}
	return in, rows.Err()
}
