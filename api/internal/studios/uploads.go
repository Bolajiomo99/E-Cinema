package studios

import (
	"context"
	"encoding/json"
	"errors"
	"path"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Film uploads (Figma 35:290). The web app moves the bytes to private storage in parts and
// records each step here; this package decides who may upload and what a file is.

// MaxUploadFiles caps how many files one film draft can hold (an IMF package has several).
const MaxUploadFiles = 40

// MaxFileBytes is 2 TB, the biggest master the upload page accepts.
const MaxFileBytes int64 = 2 << 40

const uploadCols = `id, title, logline, genres, age_rating, cast_crew, languages, poster_key, status, created_at, updated_at`

func scanUpload(r interface{ Scan(...any) error }) (Upload, error) {
	var u Upload
	err := r.Scan(&u.ID, &u.Title, &u.Logline, &u.Genres, &u.AgeRating, &u.CastCrew, &u.Languages, &u.PosterKey, &u.Status, &u.CreatedAt, &u.UpdatedAt)
	return u, err
}

var ErrTooManyFiles = errors.New("a film can have up to 40 files")

// File types a studio can send, by extension, and what each one is.
var kinds = map[string]string{
	".mov": "video", ".mp4": "video", ".m4v": "video", ".mxf": "master",
	".xml": "package",
	".wav": "stems", ".aif": "stems", ".aiff": "stems", ".flac": "stems",
	".srt": "subtitles", ".vtt": "subtitles", ".ttml": "subtitles",
}

var contentTypes = map[string]string{
	".mov": "video/quicktime", ".mp4": "video/mp4", ".m4v": "video/mp4", ".mxf": "application/mxf",
	".xml": "application/xml", ".wav": "audio/wav", ".aif": "audio/aiff", ".aiff": "audio/aiff", ".flac": "audio/flac",
	".srt": "application/x-subrip", ".vtt": "text/vtt", ".ttml": "application/ttml+xml",
}

// Check is one line of "AI checks while you upload".
type Check struct {
	State string `json:"state"` // ok, warn, soon
	Text  string `json:"text"`
}

type UploadFile struct {
	ID          string    `json:"id"`
	Kind        string    `json:"kind"`
	Name        string    `json:"name"`
	Size        int64     `json:"size"`
	ContentType string    `json:"contentType"`
	Key         string    `json:"key"`
	MpID        string    `json:"mpId"`
	Status      string    `json:"status"`
	Info        string    `json:"info"`
	Checks      []Check   `json:"checks"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type Upload struct {
	ID        string       `json:"id"`
	Title     string       `json:"title"`
	Logline   string       `json:"logline"`
	Genres    string       `json:"genres"`
	AgeRating string       `json:"ageRating"`
	CastCrew  string       `json:"castCrew"`
	Languages string       `json:"languages"`
	PosterKey string       `json:"posterKey"`
	Status    string       `json:"status"`
	CreatedAt time.Time    `json:"createdAt"`
	UpdatedAt time.Time    `json:"updatedAt"`
	Files     []UploadFile `json:"files"`
}

// verified is the caller's studio, when it may list films. write asks for the "edit" role.
func (st Store) verified(ctx context.Context, acct, email string, write bool) (Studio, error) {
	s, err := st.mine(ctx, acct, email)
	if err != nil {
		return s, err
	}
	if s.Status != "verified" {
		return s, ErrNotVerified
	}
	if write && !can(s.Role, "edit") {
		return s, ErrForbidden
	}
	return s, nil
}

var uuidRe = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func (st Store) Uploads(ctx context.Context, acct, email string) ([]Upload, error) {
	s, err := st.verified(ctx, acct, email, false)
	if err != nil {
		return nil, err
	}
	rows, err := st.DB.Query(ctx, `SELECT `+uploadCols+` FROM studio_uploads WHERE studio = $1 ORDER BY updated_at DESC LIMIT 50`, s.Name)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Upload, error) { return scanUpload(r) })
	if err != nil {
		return nil, err
	}
	for i := range out {
		if out[i].Files, err = st.files(ctx, out[i].ID); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (st Store) CreateUpload(ctx context.Context, acct, email, title string) (Upload, error) {
	s, err := st.verified(ctx, acct, email, true)
	if err != nil {
		return Upload{}, err
	}
	title = clip(title, 120)
	if title == "" {
		return Upload{}, ErrBadInput
	}
	var id string
	if err := st.DB.QueryRow(ctx, `INSERT INTO studio_uploads (studio, title, created_by) VALUES ($1, $2, $3) RETURNING id`, s.Name, title, acct).Scan(&id); err != nil {
		return Upload{}, err
	}
	return st.upload(ctx, s.Name, id)
}

func (st Store) Upload(ctx context.Context, acct, email, id string) (Upload, error) {
	s, err := st.verified(ctx, acct, email, false)
	if err != nil {
		return Upload{}, err
	}
	return st.upload(ctx, s.Name, id)
}

func (st Store) upload(ctx context.Context, studio, id string) (Upload, error) {
	if !uuidRe.MatchString(id) {
		return Upload{}, ErrNotFound
	}
	u, err := scanUpload(st.DB.QueryRow(ctx, `SELECT `+uploadCols+` FROM studio_uploads WHERE id = $1 AND studio = $2`, id, studio))
	if errors.Is(err, pgx.ErrNoRows) {
		return u, ErrNotFound
	}
	if err != nil {
		return u, err
	}
	u.Files, err = st.files(ctx, id)
	return u, err
}

func (st Store) files(ctx context.Context, upload string) ([]UploadFile, error) {
	rows, err := st.DB.Query(ctx, `SELECT id, kind, name, size_bytes, content_type, key, mp_id, status, info, checks, updated_at
	  FROM studio_upload_files WHERE upload_id = $1 ORDER BY created_at`, upload)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (UploadFile, error) {
		var f UploadFile
		var checks []byte
		err := r.Scan(&f.ID, &f.Kind, &f.Name, &f.Size, &f.ContentType, &f.Key, &f.MpID, &f.Status, &f.Info, &checks, &f.UpdatedAt)
		if err == nil {
			err = json.Unmarshal(checks, &f.Checks)
		}
		return f, err
	})
}

// RenameUpload saves the draft's title (the "Save draft" button).
func (st Store) RenameUpload(ctx context.Context, acct, email, id, title string) (Upload, error) {
	s, err := st.verified(ctx, acct, email, true)
	if err != nil {
		return Upload{}, err
	}
	title = clip(title, 120)
	if title == "" || !uuidRe.MatchString(id) {
		return Upload{}, ErrBadInput
	}
	tag, err := st.DB.Exec(ctx, `UPDATE studio_uploads SET title = $3, updated_at = now() WHERE id = $1 AND studio = $2 AND status = 'draft'`, id, s.Name, title)
	if err != nil {
		return Upload{}, err
	}
	if tag.RowsAffected() == 0 {
		return Upload{}, ErrNotFound
	}
	return st.upload(ctx, s.Name, id)
}

// KindOf says what a file is from its name, or "" when the page does not take that type.
// The first video becomes the master, a video named like a trailer is the trailer.
func KindOf(name string, haveMaster bool) string {
	ext := strings.ToLower(path.Ext(name))
	k := kinds[ext]
	if k == "video" {
		low := strings.ToLower(name)
		switch {
		case strings.Contains(low, "trailer") || strings.Contains(low, "teaser"):
			return "trailer"
		case !haveMaster:
			return "master"
		default:
			return "trailer"
		}
	}
	return k
}

// AddFile reserves a storage key for a new file in the draft.
func (st Store) AddFile(ctx context.Context, acct, email, upload, name string, size int64) (UploadFile, error) {
	s, err := st.verified(ctx, acct, email, true)
	if err != nil {
		return UploadFile{}, err
	}
	name = clip(strings.ReplaceAll(strings.ReplaceAll(name, "/", "_"), "\\", "_"), 200)
	if name == "" || size <= 0 || size > MaxFileBytes {
		return UploadFile{}, ErrBadInput
	}
	u, err := st.upload(ctx, s.Name, upload)
	if err != nil {
		return UploadFile{}, err
	}
	if u.Status != "draft" {
		return UploadFile{}, ErrLocked
	}
	if len(u.Files) >= MaxUploadFiles {
		return UploadFile{}, ErrTooManyFiles
	}
	haveMaster := false
	for _, f := range u.Files {
		haveMaster = haveMaster || f.Kind == "master"
	}
	kind := KindOf(name, haveMaster)
	if kind == "" {
		return UploadFile{}, ErrBadInput
	}
	ext := strings.ToLower(path.Ext(name))
	var id string
	err = st.DB.QueryRow(ctx, `INSERT INTO studio_upload_files (upload_id, kind, name, size_bytes, content_type, key)
	  VALUES ($1, $2, $3, $4, $5, 'pending-' || gen_random_uuid()) RETURNING id`, upload, kind, name, size, contentTypes[ext]).Scan(&id)
	if err != nil {
		return UploadFile{}, err
	}
	key := "studio-uploads/" + upload + "/" + id + ext
	if _, err := st.DB.Exec(ctx, `UPDATE studio_upload_files SET key = $2 WHERE id = $1`, id, key); err != nil {
		return UploadFile{}, err
	}
	st.touch(ctx, upload)
	return st.file(ctx, s.Name, upload, id)
}

func (st Store) touch(ctx context.Context, upload string) {
	_, _ = st.DB.Exec(ctx, `UPDATE studio_uploads SET updated_at = now() WHERE id = $1`, upload)
}

// File is one file of a draft, for anyone on the studio's team.
func (st Store) File(ctx context.Context, acct, email, upload, id string, write bool) (UploadFile, error) {
	s, err := st.verified(ctx, acct, email, write)
	if err != nil {
		return UploadFile{}, err
	}
	return st.file(ctx, s.Name, upload, id)
}

func (st Store) file(ctx context.Context, studio, upload, id string) (UploadFile, error) {
	var f UploadFile
	if !uuidRe.MatchString(upload) || !uuidRe.MatchString(id) {
		return f, ErrNotFound
	}
	var checks []byte
	err := st.DB.QueryRow(ctx, `SELECT f.id, f.kind, f.name, f.size_bytes, f.content_type, f.key, f.mp_id, f.status, f.info, f.checks, f.updated_at
	  FROM studio_upload_files f JOIN studio_uploads u ON u.id = f.upload_id
	  WHERE f.id = $1 AND f.upload_id = $2 AND u.studio = $3`, id, upload, studio).
		Scan(&f.ID, &f.Kind, &f.Name, &f.Size, &f.ContentType, &f.Key, &f.MpID, &f.Status, &f.Info, &checks, &f.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return f, ErrNotFound
	}
	if err == nil {
		err = json.Unmarshal(checks, &f.Checks)
	}
	return f, err
}

// FileUpdate is what the web app records as a file moves through storage.
type FileUpdate struct {
	MpID   *string
	Status *string
	Info   *string
	Checks *[]Check
}

func (st Store) UpdateFile(ctx context.Context, acct, email, upload, id string, u FileUpdate) (UploadFile, error) {
	s, err := st.verified(ctx, acct, email, true)
	if err != nil {
		return UploadFile{}, err
	}
	f, err := st.file(ctx, s.Name, upload, id)
	if err != nil {
		return f, err
	}
	if u.MpID != nil {
		if len(*u.MpID) > 1024 || f.MpID != "" {
			return f, ErrBadInput
		}
		f.MpID = *u.MpID
	}
	if u.Status != nil {
		if *u.Status != "uploading" && *u.Status != "uploaded" && *u.Status != "failed" {
			return f, ErrBadInput
		}
		f.Status = *u.Status
	}
	if u.Info != nil {
		f.Info = clip(*u.Info, 300)
	}
	if u.Checks != nil {
		if len(*u.Checks) > 12 {
			return f, ErrBadInput
		}
		f.Checks = f.Checks[:0]
		for _, c := range *u.Checks {
			if c.State != "ok" && c.State != "warn" && c.State != "soon" {
				return f, ErrBadInput
			}
			f.Checks = append(f.Checks, Check{State: c.State, Text: clip(c.Text, 200)})
		}
	}
	if f.Checks == nil {
		f.Checks = []Check{}
	}
	checks, _ := json.Marshal(f.Checks)
	if _, err := st.DB.Exec(ctx, `UPDATE studio_upload_files SET mp_id = $2, status = $3, info = $4, checks = $5, updated_at = now() WHERE id = $1`,
		id, f.MpID, f.Status, f.Info, checks); err != nil {
		return f, err
	}
	st.touch(ctx, upload)
	return st.file(ctx, s.Name, upload, id)
}

// RemoveFile forgets a file; the web app deletes its bytes first.
func (st Store) RemoveFile(ctx context.Context, acct, email, upload, id string) error {
	s, err := st.verified(ctx, acct, email, true)
	if err != nil {
		return err
	}
	if _, err := st.file(ctx, s.Name, upload, id); err != nil {
		return err
	}
	_, err = st.DB.Exec(ctx, `DELETE FROM studio_upload_files WHERE id = $1`, id)
	st.touch(ctx, upload)
	return err
}

// Details is what viewers will read about the film (Figma 99:247).
type Details struct {
	Title, Logline, Genres, AgeRating, CastCrew, Languages string
}

func (st Store) SaveDetails(ctx context.Context, acct, email, id string, d Details) (Upload, error) {
	s, err := st.verified(ctx, acct, email, true)
	if err != nil {
		return Upload{}, err
	}
	d.Title = clip(d.Title, 120)
	if d.Title == "" || !uuidRe.MatchString(id) {
		return Upload{}, ErrBadInput
	}
	tag, err := st.DB.Exec(ctx, `UPDATE studio_uploads SET title = $3, logline = $4, genres = $5, age_rating = $6, cast_crew = $7, languages = $8, updated_at = now()
	  WHERE id = $1 AND studio = $2 AND status = 'draft'`,
		id, s.Name, d.Title, clip(d.Logline, 300), clip(d.Genres, 80), clip(d.AgeRating, 60), clip(d.CastCrew, 400), clip(d.Languages, 80))
	if err != nil {
		return Upload{}, err
	}
	if tag.RowsAffected() == 0 {
		return Upload{}, ErrNotFound
	}
	// A published film keeps its listing in step with the details.
	if _, err := st.DB.Exec(ctx, `UPDATE showtimes SET film = $2, adult = $3 WHERE id = (SELECT showtime_id FROM studio_premieres WHERE upload = $1)`,
		id, d.Title, strings.HasPrefix(clip(d.AgeRating, 60), "18")); err != nil {
		return Upload{}, err
	}
	return st.upload(ctx, s.Name, id)
}

// SetPoster records the poster image the web app stored for the draft.
func (st Store) SetPoster(ctx context.Context, acct, email, id, key string) (Upload, error) {
	s, err := st.verified(ctx, acct, email, true)
	if err != nil {
		return Upload{}, err
	}
	if !strings.HasPrefix(key, "studio-uploads/"+id+"/poster-") || len(key) > 200 || !uuidRe.MatchString(id) {
		return Upload{}, ErrBadInput
	}
	tag, err := st.DB.Exec(ctx, `UPDATE studio_uploads SET poster_key = $3, updated_at = now() WHERE id = $1 AND studio = $2`, id, s.Name, key)
	if err != nil {
		return Upload{}, err
	}
	if tag.RowsAffected() == 0 {
		return Upload{}, ErrNotFound
	}
	return st.upload(ctx, s.Name, id)
}

// DeleteUpload removes a draft that never premiered; the web app deletes its stored files first.
func (st Store) DeleteUpload(ctx context.Context, acct, email, id string) error {
	s, err := st.verified(ctx, acct, email, true)
	if err != nil {
		return err
	}
	if !uuidRe.MatchString(id) {
		return ErrNotFound
	}
	tag, err := st.DB.Exec(ctx, `DELETE FROM studio_uploads WHERE id = $1 AND studio = $2 AND status = 'draft'
	  AND NOT EXISTS (SELECT 1 FROM studio_premieres p WHERE p.upload = $1 AND p.showtime_id IS NOT NULL)`, id, s.Name)
	if err == nil && tag.RowsAffected() == 0 {
		err = ErrNotFound
	}
	return err
}
