package exec

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// Hiring and jobs (Figma 117:948): open roles, the Nigeria quota and the pipeline.

type TeamShare struct {
	Team  string `json:"team"`
	NG    int    `json:"ng"`
	Total int    `json:"total"`
}

type Stage struct {
	Stage string `json:"stage"`
	NG    int    `json:"ng"`
	World int    `json:"world"`
}

type Hiring struct {
	Open        int            `json:"open"`
	OpenNG      int            `json:"openNg"`
	AppsQuarter int            `json:"appsQuarter"`
	Countries   int            `json:"countries"` // applicant countries this quarter
	HiredYear   int            `json:"hiredYear"`
	HiredNG     int            `json:"hiredNg"`
	DaysToHire  int            `json:"daysToHire"` // average, hires this year
	NGShare     int            `json:"ngShare"`
	Teams       []TeamShare    `json:"teams"`
	Pipeline    []Stage        `json:"pipeline"`
	ByCountry   map[string]int `json:"byCountry"` // applications this quarter
	CanPost     bool           `json:"canPost"`
	CanQuota    bool           `json:"canQuota"`
}

// CanHire: the CEO and the COO post roles. Only the CEO changes the quota.
func (st Store) CanHire(ctx context.Context, email string) error {
	return st.allowed(ctx, email, "coo")
}

func (st Store) CanSetQuota(email string) error {
	if !st.ceo(email) {
		return ErrForbidden
	}
	return nil
}

const stageRank = `CASE %s WHEN 'received' THEN 1 WHEN 'chat' THEN 2 WHEN 'task' THEN 3 WHEN 'team' THEN 4 WHEN 'offer' THEN 5 WHEN 'hired' THEN 6 ELSE 0 END`

func (st Store) Hiring(ctx context.Context, email string, now time.Time) (Hiring, error) {
	h := Hiring{Teams: []TeamShare{}, Pipeline: []Stage{}, ByCountry: map[string]int{}}
	if err := st.CanHire(ctx, email); err != nil {
		return h, err
	}
	h.CanPost, h.CanQuota = true, st.ceo(email)
	lagos := time.FixedZone("WAT", 3600)
	l := now.In(lagos)
	quarter := time.Date(l.Year(), time.Month((int(l.Month())-1)/3*3+1), 1, 0, 0, 0, 0, lagos)
	year := time.Date(l.Year(), 1, 1, 0, 0, 0, 0, lagos)
	if err := st.DB.QueryRow(ctx, `SELECT
	    (SELECT count(*) FROM jobs WHERE open), (SELECT count(*) FROM jobs WHERE open AND quota = 'ng'),
	    (SELECT count(*) FROM job_applications WHERE created_at >= $1), (SELECT count(DISTINCT country) FROM job_applications WHERE created_at >= $1),
	    (SELECT count(*) FROM job_applications a WHERE a.stage = 'hired' AND a.updated_at >= $2),
	    (SELECT count(*) FROM job_applications a JOIN jobs j ON j.slug = a.job_slug WHERE a.stage = 'hired' AND a.updated_at >= $2 AND j.quota = 'ng'),
	    coalesce((SELECT round(avg(extract(epoch FROM e.at - a.created_at) / 86400)) FROM job_applications a
	      JOIN LATERAL (SELECT min(at) AS at FROM job_application_events WHERE application_id = a.id AND stage = 'hired') e ON e.at IS NOT NULL
	      WHERE a.stage = 'hired' AND a.updated_at >= $2), 0),
	    (SELECT ng_share FROM careers_settings WHERE id = 1)`, quarter, year).Scan(
		&h.Open, &h.OpenNG, &h.AppsQuarter, &h.Countries, &h.HiredYear, &h.HiredNG, &h.DaysToHire, &h.NGShare); err != nil {
		return h, err
	}
	rows, err := st.DB.Query(ctx, `SELECT team, count(*) FILTER (WHERE quota = 'ng')::int, count(*)::int FROM jobs WHERE open GROUP BY team ORDER BY count(*) DESC, team LIMIT 10`)
	if err != nil {
		return h, err
	}
	if h.Teams, err = pgx.CollectRows(rows, pgx.RowToStructByPos[TeamShare]); err != nil {
		return h, err
	}
	// How far each application got: its current stage, or the furthest stage it reached before it closed.
	rows, err = st.DB.Query(ctx, `WITH reach AS (
	    SELECT a.country = 'NG' OR a.ng_eligible AS ng, greatest(`+fmt.Sprintf(stageRank, "a.stage")+`,
	      coalesce((SELECT max(`+fmt.Sprintf(stageRank, "e.stage")+`) FROM job_application_events e WHERE e.application_id = a.id), 1)) AS r
	    FROM job_applications a)
	  SELECT s.name, count(*) FILTER (WHERE reach.ng AND reach.r >= s.n)::int, count(*) FILTER (WHERE NOT reach.ng AND reach.r >= s.n)::int
	  FROM (VALUES ('received', 1), ('chat', 2), ('task', 3), ('team', 4), ('offer', 5), ('hired', 6)) s(name, n) CROSS JOIN reach
	  GROUP BY s.name, s.n ORDER BY s.n`)
	if err != nil {
		return h, err
	}
	if h.Pipeline, err = pgx.CollectRows(rows, pgx.RowToStructByPos[Stage]); err != nil {
		return h, err
	}
	rows, err = st.DB.Query(ctx, `SELECT country, count(*)::int FROM job_applications WHERE created_at >= $1 GROUP BY country ORDER BY count(*) DESC LIMIT 6`, quarter)
	if err != nil {
		return h, err
	}
	defer rows.Close()
	for rows.Next() {
		var c string
		var n int
		if err := rows.Scan(&c, &n); err != nil {
			return h, err
		}
		h.ByCountry[c] = n
	}
	return h, rows.Err()
}
