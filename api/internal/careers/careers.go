// Package careers runs the jobs board (Figma 94:1157, 114:1273, 114:1397, 114:1531): roles the
// team posts, applications with a CV, the hiring stages each applicant can follow, and the share
// of roles kept for Nigeria. It also keeps group screening quote requests (Figma 94:1239).
package careers

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound    = errors.New("not found")
	ErrBadInput    = errors.New("invalid request")
	ErrClosed      = errors.New("this role is no longer open")
	ErrApplied     = errors.New("you have already applied for this role")
	ErrNotEligible = errors.New("this role is kept for Nigerian citizens and people living in Nigeria")
)

// Stages in order. Closed can follow any stage.
var Stages = []string{"received", "chat", "task", "team", "offer", "hired"}

var (
	slugRe    = regexp.MustCompile(`^[a-z0-9-]{3,80}$`)
	countryRe = regexp.MustCompile(`^[A-Z]{2}$`)
	cvRe      = regexp.MustCompile(`^careers/[0-9a-f-]{36}\.pdf$`)
)

type Store struct{ DB *pgxpool.Pool }

type Job struct {
	Slug      string    `json:"slug"`
	Title     string    `json:"title"`
	Team      string    `json:"team"`
	City      string    `json:"city"`
	Country   string    `json:"country"`
	Remote    bool      `json:"remote"`
	Kind      string    `json:"kind"`
	Quota     string    `json:"quota"`
	Pay       string    `json:"pay"`
	Setup     string    `json:"setup"`
	About     string    `json:"about"`
	Bring     string    `json:"bring"`
	Open      bool      `json:"open"`
	CreatedAt time.Time `json:"createdAt"`
	Applied   int       `json:"applied,omitempty"` // staff view only
}

const jobCols = `slug, title, team, city, country, remote, kind, quota, pay, setup, about, bring, open, created_at`

func scanJob(r pgx.Row) (Job, error) {
	var j Job
	err := r.Scan(&j.Slug, &j.Title, &j.Team, &j.City, &j.Country, &j.Remote, &j.Kind, &j.Quota, &j.Pay, &j.Setup, &j.About, &j.Bring, &j.Open, &j.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return j, ErrNotFound
	}
	return j, err
}

// Filter narrows the board. Quota is ng or world; Kind can also be "remote".
type Filter struct {
	Q, Country, Team, Quota, Kind string
}

type Board struct {
	Jobs    []Job          `json:"jobs"`
	Total   int            `json:"total"`
	Nigeria int            `json:"nigeria"`
	World   int            `json:"world"`
	NGShare int            `json:"ngShare"`
	Teams   []string       `json:"teams"`
	Kinds   map[string]int `json:"kinds"`
}

// Open lists open roles matching the filter, with counts across all open roles.
func (st Store) Open(ctx context.Context, f Filter) (Board, error) {
	b := Board{Kinds: map[string]int{}}
	if err := st.DB.QueryRow(ctx, `SELECT ng_share FROM careers_settings WHERE id = 1`).Scan(&b.NGShare); err != nil {
		return b, err
	}
	rows, err := st.DB.Query(ctx, `SELECT `+jobCols+` FROM jobs WHERE open ORDER BY created_at DESC`)
	if err != nil {
		return b, err
	}
	all, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Job, error) { return scanJob(r) })
	if err != nil {
		return b, err
	}
	teams := map[string]bool{}
	q := strings.ToLower(strings.TrimSpace(f.Q))
	b.Jobs = []Job{}
	for _, j := range all {
		b.Total++
		if j.Quota == "ng" {
			b.Nigeria++
		} else {
			b.World++
		}
		if j.Remote {
			b.Kinds["remote"]++
		}
		b.Kinds[j.Kind]++
		if !teams[j.Team] {
			teams[j.Team] = true
			b.Teams = append(b.Teams, j.Team)
		}
		if q != "" && !strings.Contains(strings.ToLower(j.Title+" "+j.Team+" "+j.City), q) {
			continue
		}
		if f.Team != "" && j.Team != f.Team || f.Quota != "" && j.Quota != f.Quota {
			continue
		}
		if f.Country != "" && j.Country != f.Country && !j.Remote {
			continue
		}
		if f.Kind == "remote" && !j.Remote || f.Kind != "" && f.Kind != "remote" && j.Kind != f.Kind {
			continue
		}
		b.Jobs = append(b.Jobs, j)
	}
	return b, nil
}

func (st Store) Job(ctx context.Context, slug string) (Job, error) {
	return scanJob(st.DB.QueryRow(ctx, `SELECT `+jobCols+` FROM jobs WHERE slug = $1`, slug))
}

// SaveJob posts or edits a role (staff).
func (st Store) SaveJob(ctx context.Context, j Job) (Job, error) {
	j.Title, j.Team, j.City = strings.TrimSpace(j.Title), strings.TrimSpace(j.Team), strings.TrimSpace(j.City)
	j.About, j.Bring = strings.TrimSpace(j.About), strings.TrimSpace(j.Bring)
	switch {
	case !slugRe.MatchString(j.Slug):
		return j, fmt.Errorf("%w: the link name uses lower-case letters, numbers and dashes", ErrBadInput)
	case j.Title == "" || len(j.Title) > 120 || j.Team == "" || len(j.Team) > 40 || j.City == "" || len(j.City) > 80:
		return j, fmt.Errorf("%w: add a title, team and city", ErrBadInput)
	case !countryRe.MatchString(j.Country):
		return j, fmt.Errorf("%w: pick a country", ErrBadInput)
	case j.Kind != "full" && j.Kind != "part" && j.Kind != "intern" && j.Kind != "shift":
		return j, fmt.Errorf("%w: pick full time, part time, internship or shift work", ErrBadInput)
	case j.Quota != "ng" && j.Quota != "world":
		return j, fmt.Errorf("%w: say whether the role is kept for Nigeria or open worldwide", ErrBadInput)
	case j.About == "" || j.Bring == "" || len(j.About) > 2000 || len(j.Bring) > 2000:
		return j, fmt.Errorf("%w: say what the person will do and what they bring", ErrBadInput)
	case len(j.Pay) > 80 || len(j.Setup) > 40:
		return j, fmt.Errorf("%w: keep pay and setup short", ErrBadInput)
	}
	return scanJob(st.DB.QueryRow(ctx, `INSERT INTO jobs (slug, title, team, city, country, remote, kind, quota, pay, setup, about, bring, open)
	  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
	  ON CONFLICT (slug) DO UPDATE SET title = $2, team = $3, city = $4, country = $5, remote = $6, kind = $7, quota = $8, pay = $9, setup = $10, about = $11, bring = $12, open = $13
	  RETURNING `+jobCols, j.Slug, j.Title, j.Team, j.City, j.Country, j.Remote, j.Kind, j.Quota, j.Pay, j.Setup, j.About, j.Bring, j.Open))
}

// AllJobs is the staff list, open and closed, with how many applied.
func (st Store) AllJobs(ctx context.Context) ([]Job, error) {
	rows, err := st.DB.Query(ctx, `SELECT `+jobCols+`, (SELECT count(*) FROM job_applications a WHERE a.job_slug = j.slug)::int FROM jobs j ORDER BY open DESC, created_at DESC`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Job, error) {
		var j Job
		err := r.Scan(&j.Slug, &j.Title, &j.Team, &j.City, &j.Country, &j.Remote, &j.Kind, &j.Quota, &j.Pay, &j.Setup, &j.About, &j.Bring, &j.Open, &j.CreatedAt, &j.Applied)
		return j, err
	})
}

// SetShare is the CEO setting the share of roles kept for Nigeria.
func (st Store) SetShare(ctx context.Context, pct int) error {
	if pct < 0 || pct > 100 {
		return fmt.Errorf("%w: the share is between 0 and 100", ErrBadInput)
	}
	_, err := st.DB.Exec(ctx, `UPDATE careers_settings SET ng_share = $1 WHERE id = 1`, pct)
	return err
}

type Event struct {
	Stage  string    `json:"stage"`
	At     time.Time `json:"at"`
	Detail string    `json:"detail"`
}

type Application struct {
	ID            string     `json:"id"`
	Job           Job        `json:"job"`
	Name          string     `json:"name"`
	Email         string     `json:"email"`
	Country       string     `json:"country"`
	Link          string     `json:"link"`
	CVKey         string     `json:"cvKey,omitempty"`
	Why           string     `json:"why"`
	Keep          bool       `json:"keep"`
	NGEligible    bool       `json:"ngEligible"`
	Stage         string     `json:"stage"`
	Message       string     `json:"message"`
	TaskDue       *time.Time `json:"taskDue,omitempty"`
	TaskPay       string     `json:"taskPay"`
	InterviewAt   *time.Time `json:"interviewAt,omitempty"`
	InterviewWith string     `json:"interviewWith"`
	CreatedAt     time.Time  `json:"createdAt"`
	UpdatedAt     time.Time  `json:"updatedAt"`
	Events        []Event    `json:"events"`
}

type Applying struct {
	Name       string `json:"name"`
	Email      string `json:"email"`
	Country    string `json:"country"`
	Link       string `json:"link"`
	CVKey      string `json:"cvKey"`
	Why        string `json:"why"`
	Keep       bool   `json:"keep"`
	NGEligible bool   `json:"ngEligible"` // Nigerian citizen living abroad
}

// Apply sends an application. Nigeria roles need someone living in Nigeria or a Nigerian citizen.
func (st Store) Apply(ctx context.Context, accountID, slug string, a Applying) (Application, error) {
	a.Name, a.Email, a.Link, a.Why = strings.TrimSpace(a.Name), strings.TrimSpace(a.Email), strings.TrimSpace(a.Link), strings.TrimSpace(a.Why)
	a.Country = strings.ToUpper(strings.TrimSpace(a.Country))
	if a.Name == "" || len(a.Name) > 100 {
		return Application{}, fmt.Errorf("%w: add your full name", ErrBadInput)
	}
	if addr, err := mail.ParseAddress(a.Email); err != nil || addr.Address != a.Email || len(a.Email) > 200 {
		return Application{}, fmt.Errorf("%w: check your email", ErrBadInput)
	}
	if !countryRe.MatchString(a.Country) {
		return Application{}, fmt.Errorf("%w: pick the country you live in", ErrBadInput)
	}
	if len(a.Link) > 300 || len(a.Why) > 1500 {
		return Application{}, fmt.Errorf("%w: keep the link and note shorter", ErrBadInput)
	}
	if !cvRe.MatchString(a.CVKey) {
		return Application{}, fmt.Errorf("%w: add your CV as a PDF", ErrBadInput)
	}
	j, err := st.Job(ctx, slug)
	if err != nil {
		return Application{}, err
	}
	if !j.Open {
		return Application{}, ErrClosed
	}
	eligible := a.Country == "NG" || a.NGEligible
	if j.Quota == "ng" && !eligible {
		return Application{}, ErrNotEligible
	}
	var id string
	err = pgx.BeginFunc(ctx, st.DB, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `INSERT INTO job_applications (job_slug, account_id, name, email, country, link, cv_key, why, keep, ng_eligible)
		  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (job_slug, account_id) DO NOTHING RETURNING id`,
			slug, accountID, a.Name, a.Email, a.Country, a.Link, a.CVKey, a.Why, a.Keep, eligible).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrApplied
		}
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO job_application_events (application_id, stage) VALUES ($1, 'received')`, id)
		return err
	})
	if err != nil {
		return Application{}, err
	}
	return st.application(ctx, `a.id = $1`, id)
}

const appCols = `a.id, a.name, a.email, a.country, a.link, a.cv_key, a.why, a.keep, a.ng_eligible, a.stage, a.message, a.task_due, a.task_pay,
  a.interview_at, a.interview_with, a.created_at, a.updated_at, ` + "j.slug, j.title, j.team, j.city, j.country, j.remote, j.kind, j.quota, j.pay, j.setup, j.about, j.bring, j.open, j.created_at"

func scanApp(r pgx.Row) (Application, error) {
	var a Application
	var due *time.Time
	j := &a.Job
	err := r.Scan(&a.ID, &a.Name, &a.Email, &a.Country, &a.Link, &a.CVKey, &a.Why, &a.Keep, &a.NGEligible, &a.Stage, &a.Message, &due, &a.TaskPay,
		&a.InterviewAt, &a.InterviewWith, &a.CreatedAt, &a.UpdatedAt,
		&j.Slug, &j.Title, &j.Team, &j.City, &j.Country, &j.Remote, &j.Kind, &j.Quota, &j.Pay, &j.Setup, &j.About, &j.Bring, &j.Open, &j.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return a, ErrNotFound
	}
	a.TaskDue = due
	return a, err
}

func (st Store) events(ctx context.Context, list []Application) error {
	for i := range list {
		rows, err := st.DB.Query(ctx, `SELECT stage, at, detail FROM job_application_events WHERE application_id = $1 ORDER BY at`, list[i].ID)
		if err != nil {
			return err
		}
		ev, err := pgx.CollectRows(rows, pgx.RowToStructByPos[Event])
		if err != nil {
			return err
		}
		list[i].Events = ev
	}
	return nil
}

func (st Store) application(ctx context.Context, where string, args ...any) (Application, error) {
	a, err := scanApp(st.DB.QueryRow(ctx, `SELECT `+appCols+` FROM job_applications a JOIN jobs j ON j.slug = a.job_slug WHERE `+where, args...))
	if err != nil {
		return a, err
	}
	list := []Application{a}
	err = st.events(ctx, list)
	return list[0], err
}

func (st Store) list(ctx context.Context, where string, args ...any) ([]Application, error) {
	rows, err := st.DB.Query(ctx, `SELECT `+appCols+` FROM job_applications a JOIN jobs j ON j.slug = a.job_slug WHERE `+where+` ORDER BY a.updated_at DESC LIMIT 300`, args...)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Application, error) { return scanApp(r) })
	if err != nil {
		return nil, err
	}
	return list, st.events(ctx, list)
}

// Mine lists the member's applications. The CV key stays server side.
func (st Store) Mine(ctx context.Context, accountID string) ([]Application, error) {
	list, err := st.list(ctx, `a.account_id = $1`, accountID)
	for i := range list {
		list[i].CVKey = ""
	}
	return list, err
}

// Applied says which roles the member has applied for.
func (st Store) Applied(ctx context.Context, accountID, slug string) (*Application, error) {
	a, err := st.application(ctx, `a.account_id = $1 AND a.job_slug = $2`, accountID, slug)
	if errors.Is(err, ErrNotFound) {
		return nil, nil
	}
	a.CVKey = ""
	return &a, err
}

// Pipeline is the hiring team's list: open applications first, optionally for one role.
func (st Store) Pipeline(ctx context.Context, slug string) ([]Application, error) {
	if slug != "" {
		return st.list(ctx, `a.job_slug = $1`, slug)
	}
	return st.list(ctx, `a.stage NOT IN ('hired', 'closed') OR a.updated_at > now() - interval '30 days'`)
}

func (st Store) Get(ctx context.Context, id string) (Application, error) {
	return st.application(ctx, `a.id = $1`, id)
}

// Move is the hiring team changing an application: its stage and what the applicant sees.
type Move struct {
	Stage         string     `json:"stage"`
	Message       string     `json:"message"`
	TaskDue       *time.Time `json:"taskDue"`
	TaskPay       string     `json:"taskPay"`
	InterviewAt   *time.Time `json:"interviewAt"`
	InterviewWith string     `json:"interviewWith"`
}

func (st Store) Advance(ctx context.Context, id string, m Move) (Application, error) {
	m.Message, m.TaskPay, m.InterviewWith = strings.TrimSpace(m.Message), strings.TrimSpace(m.TaskPay), strings.TrimSpace(m.InterviewWith)
	if len(m.Message) > 1000 || len(m.TaskPay) > 80 || len(m.InterviewWith) > 120 {
		return Application{}, fmt.Errorf("%w: keep the message shorter", ErrBadInput)
	}
	a, err := st.Get(ctx, id)
	if err != nil {
		return a, err
	}
	if a.Stage == "hired" || a.Stage == "closed" {
		return a, fmt.Errorf("%w: this application is finished", ErrBadInput)
	}
	if m.Stage == "" {
		m.Stage = a.Stage
	}
	from, to := index(a.Stage), index(m.Stage)
	if m.Stage != "closed" && (to < 0 || to < from) {
		return a, fmt.Errorf("%w: an application only moves forward", ErrBadInput)
	}
	if m.Stage == "closed" && m.Message == "" {
		return a, fmt.Errorf("%w: tell the applicant why, kindly", ErrBadInput)
	}
	detail := m.Message
	if m.InterviewAt != nil {
		detail = strings.TrimSpace(m.InterviewAt.UTC().Format(time.RFC3339) + " " + m.InterviewWith)
	}
	err = pgx.BeginFunc(ctx, st.DB, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE job_applications SET stage = $2, message = CASE WHEN $3 = '' THEN message ELSE $3 END,
		  task_due = coalesce($4::date, task_due), task_pay = CASE WHEN $5 = '' THEN task_pay ELSE $5 END,
		  interview_at = coalesce($6, interview_at), interview_with = CASE WHEN $7 = '' THEN interview_with ELSE $7 END, updated_at = now()
		  WHERE id = $1`, id, m.Stage, m.Message, m.TaskDue, m.TaskPay, m.InterviewAt, m.InterviewWith)
		if err != nil {
			return err
		}
		if m.Stage != a.Stage || m.InterviewAt != nil {
			_, err = tx.Exec(ctx, `INSERT INTO job_application_events (application_id, stage, detail) VALUES ($1, $2, $3)`, id, m.Stage, detail)
		}
		return err
	})
	if err != nil {
		return a, err
	}
	return st.Get(ctx, id)
}

func index(stage string) int {
	for i, s := range Stages {
		if s == stage {
			return i
		}
	}
	return -1
}

// Withdraw lets the applicant step back from an open application.
func (st Store) Withdraw(ctx context.Context, accountID, id string) error {
	err := pgx.BeginFunc(ctx, st.DB, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE job_applications SET stage = 'closed', message = 'You withdrew this application.', updated_at = now()
		  WHERE id = $1 AND account_id = $2 AND stage NOT IN ('hired', 'closed')`, id, accountID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		_, err = tx.Exec(ctx, `INSERT INTO job_application_events (application_id, stage, detail) VALUES ($1, 'closed', 'Withdrawn')`, id)
		return err
	})
	return err
}

type Quote struct {
	ID           string    `json:"id"`
	Organisation string    `json:"organisation"`
	Email        string    `json:"email"`
	Guests       int       `json:"guests"`
	Country      string    `json:"country"`
	Kind         string    `json:"kind"`
	Note         string    `json:"note"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"createdAt"`
}

var quoteKinds = map[string]bool{"": true, "company": true, "school": true, "faith": true, "brand": true}

// AskQuote records a group screening request for the sales team.
func (st Store) AskQuote(ctx context.Context, q Quote) (Quote, error) {
	q.Organisation, q.Email, q.Note = strings.TrimSpace(q.Organisation), strings.TrimSpace(q.Email), strings.TrimSpace(q.Note)
	q.Country = strings.ToUpper(strings.TrimSpace(q.Country))
	switch {
	case q.Organisation == "" || len(q.Organisation) > 120:
		return q, fmt.Errorf("%w: add your organisation", ErrBadInput)
	case len(q.Email) > 200:
		return q, fmt.Errorf("%w: check your work email", ErrBadInput)
	case q.Guests < 2 || q.Guests > 50000:
		return q, fmt.Errorf("%w: guests are between 2 and 50,000", ErrBadInput)
	case !countryRe.MatchString(q.Country):
		return q, fmt.Errorf("%w: pick a country", ErrBadInput)
	case !quoteKinds[q.Kind] || len(q.Note) > 1000:
		return q, fmt.Errorf("%w: check the details", ErrBadInput)
	}
	if addr, err := mail.ParseAddress(q.Email); err != nil || addr.Address != q.Email {
		return q, fmt.Errorf("%w: check your work email", ErrBadInput)
	}
	err := st.DB.QueryRow(ctx, `INSERT INTO business_quotes (organisation, email, guests, country, kind, note) VALUES ($1, $2, $3, $4, $5, $6)
	  RETURNING id, status, created_at`, q.Organisation, q.Email, q.Guests, q.Country, q.Kind, q.Note).Scan(&q.ID, &q.Status, &q.CreatedAt)
	return q, err
}

func (st Store) Quotes(ctx context.Context) ([]Quote, error) {
	rows, err := st.DB.Query(ctx, `SELECT id, organisation, email, guests, country, kind, note, status, created_at FROM business_quotes ORDER BY created_at DESC LIMIT 200`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Quote])
}

func (st Store) SetQuote(ctx context.Context, id, status string) error {
	if status != "new" && status != "contacted" && status != "won" && status != "lost" {
		return ErrBadInput
	}
	tag, err := st.DB.Exec(ctx, `UPDATE business_quotes SET status = $2 WHERE id = $1`, id, status)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}
