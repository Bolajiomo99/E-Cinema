package studios

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// AI dubbing and subtitles (Figma 35:871). The web app translates the film's subtitles with
// Claude and voices each line with ElevenLabs; this package keeps every line, who may change it
// and when a language is ready to approve.

// MaxDubLines caps one language of one film (a feature film has about 1,500 subtitle lines).
const MaxDubLines = 5000

// MaxDubs caps how many languages one film can be dubbed into.
const MaxDubs = 45

var (
	langRe         = regexp.MustCompile(`^[a-z]{2,3}$`)
	ErrDubBusy     = errors.New("this language is still being prepared")
	ErrNotReady    = errors.New("voice every line and clear every flag first")
	ErrNotLive     = errors.New("publish the premiere first")
	ErrTooManyDubs = errors.New("a film can have up to 45 languages")
)

type Dub struct {
	Lang       string     `json:"lang"`
	Status     string     `json:"status"`
	Voice      string     `json:"voice"`
	LipSync    bool       `json:"lipSync"`
	KeepMusic  bool       `json:"keepMusic"`
	Error      string     `json:"error"`
	Lines      int        `json:"lines"`
	Flagged    int        `json:"flagged"`
	Voiced     int        `json:"voiced"`
	ApprovedAt *time.Time `json:"approvedAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
}

type DubLine struct {
	Idx      int    `json:"idx"`
	StartMs  int    `json:"startMs"`
	EndMs    int    `json:"endMs"`
	Speaker  string `json:"speaker"`
	Source   string `json:"source"`
	Text     string `json:"text"`
	Flag     string `json:"flag"`
	AudioKey string `json:"audioKey"`
}

const dubCols = `d.lang, d.status, d.voice, d.lip_sync, d.keep_music, d.error, d.approved_at, d.updated_at,
  (SELECT count(*) FROM studio_dub_lines l WHERE l.upload = d.upload AND l.lang = d.lang)::int,
  (SELECT count(*) FROM studio_dub_lines l WHERE l.upload = d.upload AND l.lang = d.lang AND l.flag <> '')::int,
  (SELECT count(*) FROM studio_dub_lines l WHERE l.upload = d.upload AND l.lang = d.lang AND l.audio_key <> '')::int`

func scanDub(r interface{ Scan(...any) error }) (Dub, error) {
	var d Dub
	err := r.Scan(&d.Lang, &d.Status, &d.Voice, &d.LipSync, &d.KeepMusic, &d.Error, &d.ApprovedAt, &d.UpdatedAt, &d.Lines, &d.Flagged, &d.Voiced)
	return d, err
}

func (st Store) dubs(ctx context.Context, upload string) ([]Dub, error) {
	rows, err := st.DB.Query(ctx, `SELECT `+dubCols+` FROM studio_dubs d WHERE d.upload = $1 ORDER BY d.created_at`, upload)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Dub, error) { return scanDub(r) })
}

func (st Store) dub(ctx context.Context, upload, lang string) (Dub, error) {
	d, err := scanDub(st.DB.QueryRow(ctx, `SELECT `+dubCols+` FROM studio_dubs d WHERE d.upload = $1 AND d.lang = $2`, upload, lang))
	if errors.Is(err, pgx.ErrNoRows) {
		return d, ErrNotFound
	}
	return d, err
}

// mineUpload checks the caller may see (or, with write, change) the film.
func (st Store) mineUpload(ctx context.Context, acct, email, id string, write bool) (Upload, error) {
	s, err := st.verified(ctx, acct, email, write)
	if err != nil {
		return Upload{}, err
	}
	return st.upload(ctx, s.Name, id)
}

func (st Store) Dubs(ctx context.Context, acct, email, id string) ([]Dub, error) {
	if _, err := st.mineUpload(ctx, acct, email, id, false); err != nil {
		return nil, err
	}
	return st.dubs(ctx, id)
}

// StartDub asks for a new language. It needs a finished subtitle file to translate from.
func (st Store) StartDub(ctx context.Context, acct, email, id, lang string) (Dub, error) {
	u, err := st.mineUpload(ctx, acct, email, id, true)
	if err != nil {
		return Dub{}, err
	}
	if !langRe.MatchString(lang) {
		return Dub{}, bad("pick a language")
	}
	subs := false
	for _, f := range u.Files {
		if f.Kind == "subtitles" && f.Status == "uploaded" {
			subs = true
		}
	}
	if !subs {
		return Dub{}, bad("upload a subtitle file first; AI dubbing translates from it")
	}
	var n int
	if err := st.DB.QueryRow(ctx, `SELECT count(*) FROM studio_dubs WHERE upload = $1`, id).Scan(&n); err != nil {
		return Dub{}, err
	}
	if n >= MaxDubs {
		return Dub{}, ErrTooManyDubs
	}
	tag, err := st.DB.Exec(ctx, `INSERT INTO studio_dubs (upload, lang) VALUES ($1, $2) ON CONFLICT DO NOTHING`, id, lang)
	if err != nil {
		return Dub{}, err
	}
	if tag.RowsAffected() == 0 {
		// Asking again retries a language that failed.
		if _, err := st.DB.Exec(ctx, `UPDATE studio_dubs SET status = 'translating', error = '', updated_at = now() WHERE upload = $1 AND lang = $2 AND status = 'failed'`, id, lang); err != nil {
			return Dub{}, err
		}
	}
	return st.dub(ctx, id, lang)
}

func (st Store) DubLines(ctx context.Context, acct, email, id, lang string) (Dub, []DubLine, error) {
	if _, err := st.mineUpload(ctx, acct, email, id, false); err != nil {
		return Dub{}, nil, err
	}
	d, err := st.dub(ctx, id, lang)
	if err != nil {
		return d, nil, err
	}
	lines, err := st.lines(ctx, id, lang)
	return d, lines, err
}

func (st Store) lines(ctx context.Context, upload, lang string) ([]DubLine, error) {
	rows, err := st.DB.Query(ctx, `SELECT idx, start_ms, end_ms, speaker, source, text, flag, audio_key FROM studio_dub_lines WHERE upload = $1 AND lang = $2 ORDER BY idx`, upload, lang)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (DubLine, error) {
		var l DubLine
		err := r.Scan(&l.Idx, &l.StartMs, &l.EndMs, &l.Speaker, &l.Source, &l.Text, &l.Flag, &l.AudioKey)
		return l, err
	})
}

// DubSettings are the voice choices for a language.
type DubSettings struct {
	Voice     string
	LipSync   bool
	KeepMusic bool
}

func (st Store) SetDub(ctx context.Context, acct, email, id, lang string, s DubSettings) (Dub, error) {
	if _, err := st.mineUpload(ctx, acct, email, id, true); err != nil {
		return Dub{}, err
	}
	if s.Voice != "ai" && s.Voice != "clone" && s.Voice != "actor" {
		return Dub{}, bad("pick a voice")
	}
	tag, err := st.DB.Exec(ctx, `UPDATE studio_dubs SET voice = $3, lip_sync = $4, keep_music = $5, updated_at = now() WHERE upload = $1 AND lang = $2`, id, lang, s.Voice, s.LipSync, s.KeepMusic)
	if err == nil && tag.RowsAffected() == 0 {
		err = ErrNotFound
	}
	if err != nil {
		return Dub{}, err
	}
	return st.dub(ctx, id, lang)
}

// EditLine changes one translated line. A new text needs a new voice, so its audio is cleared and
// an approved language goes back to review.
func (st Store) EditLine(ctx context.Context, acct, email, id, lang string, idx int, text string, clearFlag bool) (DubLine, error) {
	if _, err := st.mineUpload(ctx, acct, email, id, true); err != nil {
		return DubLine{}, err
	}
	text = clip(text, 600)
	if text == "" {
		return DubLine{}, bad("a line cannot be empty")
	}
	d, err := st.dub(ctx, id, lang)
	if err != nil {
		return DubLine{}, err
	}
	if d.Status == "translating" || d.Status == "voicing" {
		return DubLine{}, ErrDubBusy
	}
	var l DubLine
	err = st.DB.QueryRow(ctx, `UPDATE studio_dub_lines SET
	    audio_key = CASE WHEN text = $4 THEN audio_key ELSE '' END,
	    flag = CASE WHEN $5 OR text <> $4 THEN '' ELSE flag END,
	    text = $4
	  WHERE upload = $1 AND lang = $2 AND idx = $3
	  RETURNING idx, start_ms, end_ms, speaker, source, text, flag, audio_key`, id, lang, idx, text, clearFlag).
		Scan(&l.Idx, &l.StartMs, &l.EndMs, &l.Speaker, &l.Source, &l.Text, &l.Flag, &l.AudioKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return l, ErrNotFound
	}
	if err != nil {
		return l, err
	}
	_, err = st.DB.Exec(ctx, `UPDATE studio_dubs SET status = CASE WHEN status = 'approved' AND $3 = '' THEN 'review' ELSE status END,
	    approved_at = CASE WHEN $3 = '' THEN NULL ELSE approved_at END, updated_at = now() WHERE upload = $1 AND lang = $2`, id, lang, l.AudioKey)
	return l, err
}

// Voice starts (or carries on) voicing every line that has no audio yet.
func (st Store) Voice(ctx context.Context, acct, email, id, lang string) (Dub, error) {
	if _, err := st.mineUpload(ctx, acct, email, id, true); err != nil {
		return Dub{}, err
	}
	tag, err := st.DB.Exec(ctx, `UPDATE studio_dubs SET status = 'voicing', error = '', updated_at = now() WHERE upload = $1 AND lang = $2 AND status IN ('review', 'approved')`, id, lang)
	if err != nil {
		return Dub{}, err
	}
	if tag.RowsAffected() == 0 {
		if _, err := st.dub(ctx, id, lang); err != nil {
			return Dub{}, err
		}
		return Dub{}, ErrDubBusy
	}
	return st.dub(ctx, id, lang)
}

// Approve marks a language ready for viewers once every line is voiced and nothing is flagged.
func (st Store) Approve(ctx context.Context, acct, email, id, lang string) (Dub, error) {
	if _, err := st.mineUpload(ctx, acct, email, id, true); err != nil {
		return Dub{}, err
	}
	d, err := st.dub(ctx, id, lang)
	if err != nil {
		return d, err
	}
	if d.Status != "review" || d.Lines == 0 || d.Flagged > 0 || d.Voiced < d.Lines {
		return d, ErrNotReady
	}
	if _, err := st.DB.Exec(ctx, `UPDATE studio_dubs SET status = 'approved', approved_at = now(), updated_at = now() WHERE upload = $1 AND lang = $2`, id, lang); err != nil {
		return d, err
	}
	return st.dub(ctx, id, lang)
}

func (st Store) RemoveDub(ctx context.Context, acct, email, id, lang string) ([]string, error) {
	if _, err := st.mineUpload(ctx, acct, email, id, true); err != nil {
		return nil, err
	}
	var keys []string
	rows, err := st.DB.Query(ctx, `SELECT audio_key FROM studio_dub_lines WHERE upload = $1 AND lang = $2 AND audio_key <> ''`, id, lang)
	if err != nil {
		return nil, err
	}
	keys, err = pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	tag, err := st.DB.Exec(ctx, `DELETE FROM studio_dubs WHERE upload = $1 AND lang = $2`, id, lang)
	if err == nil && tag.RowsAffected() == 0 {
		err = ErrNotFound
	}
	return keys, err
}

// --- The web app's dubbing worker (internal calls, no account). ---

// DubJob is a language the worker should move forward.
type DubJob struct {
	Upload     string       `json:"upload"`
	Title      string       `json:"title"`
	Lang       string       `json:"lang"`
	Status     string       `json:"status"`
	Files      []UploadFile `json:"files"`
	ShowtimeID *string      `json:"showtimeId"`
}

// DubWork lists languages waiting to be translated or voiced, oldest first.
func (st Store) DubWork(ctx context.Context) ([]DubJob, error) {
	rows, err := st.DB.Query(ctx, `SELECT d.upload, u.title, d.lang, d.status, p.showtime_id FROM studio_dubs d JOIN studio_uploads u ON u.id = d.upload
	  LEFT JOIN studio_premieres p ON p.upload = d.upload
	  WHERE d.status IN ('translating', 'voicing') ORDER BY d.updated_at LIMIT 50`)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (DubJob, error) {
		var j DubJob
		err := r.Scan(&j.Upload, &j.Title, &j.Lang, &j.Status, &j.ShowtimeID)
		return j, err
	})
	if err != nil {
		return nil, err
	}
	for i := range out {
		if out[i].Files, err = st.files(ctx, out[i].Upload); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// DubJobLines is every line of a language, for the worker.
func (st Store) DubJobLines(ctx context.Context, upload, lang string) ([]DubLine, error) {
	if !uuidRe.MatchString(upload) || !langRe.MatchString(lang) {
		return nil, ErrNotFound
	}
	return st.lines(ctx, upload, lang)
}

// SetDubLines stores a fresh translation and sends the language to review.
func (st Store) SetDubLines(ctx context.Context, upload, lang string, lines []DubLine) error {
	if !uuidRe.MatchString(upload) || !langRe.MatchString(lang) || len(lines) == 0 || len(lines) > MaxDubLines {
		return ErrBadInput
	}
	tx, err := st.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM studio_dub_lines WHERE upload = $1 AND lang = $2`, upload, lang); err != nil {
		return err
	}
	rows := make([][]any, 0, len(lines))
	for i, l := range lines {
		if l.EndMs < l.StartMs || l.StartMs < 0 {
			return ErrBadInput
		}
		rows = append(rows, []any{upload, lang, i, l.StartMs, l.EndMs, clip(l.Speaker, 40), clip(l.Source, 600), clip(l.Text, 600), clip(l.Flag, 120)})
	}
	if _, err := tx.CopyFrom(ctx, pgx.Identifier{"studio_dub_lines"}, []string{"upload", "lang", "idx", "start_ms", "end_ms", "speaker", "source", "text", "flag"}, pgx.CopyFromRows(rows)); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `UPDATE studio_dubs SET status = 'review', error = '', updated_at = now() WHERE upload = $1 AND lang = $2 AND status = 'translating'`, upload, lang)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return tx.Commit(ctx)
}

// SetLineAudio records the voiced clip of one line; the text must still be the one voiced.
func (st Store) SetLineAudio(ctx context.Context, upload, lang string, idx int, text, key string) error {
	if !strings.HasPrefix(key, "studio-dubs/"+upload+"/"+lang+"/") {
		return ErrBadInput
	}
	tag, err := st.DB.Exec(ctx, `UPDATE studio_dub_lines SET audio_key = $5 WHERE upload = $1 AND lang = $2 AND idx = $3 AND text = $4`, upload, lang, idx, text, key)
	if err == nil && tag.RowsAffected() == 0 {
		err = ErrNotFound
	}
	return err
}

// SetLineDraft replaces one line with a regenerated translation (the worker's "Regenerate line").
func (st Store) SetLineDraft(ctx context.Context, upload, lang string, idx int, text, flag string) error {
	text = clip(text, 600)
	if text == "" {
		return ErrBadInput
	}
	_, err := st.DB.Exec(ctx, `UPDATE studio_dub_lines SET text = $4, flag = $5, audio_key = CASE WHEN text = $4 THEN audio_key ELSE '' END WHERE upload = $1 AND lang = $2 AND idx = $3`, upload, lang, idx, text, clip(flag, 120))
	return err
}

// FinishDub ends a translating or voicing run: back to review, or failed with a reason.
func (st Store) FinishDub(ctx context.Context, upload, lang, failure string) error {
	status := "review"
	if failure != "" {
		status = "failed"
	}
	_, err := st.DB.Exec(ctx, `UPDATE studio_dubs SET status = CASE WHEN $3 = 'failed' AND status = 'voicing' THEN 'review' ELSE $3 END, error = $4, updated_at = now()
	  WHERE upload = $1 AND lang = $2 AND status IN ('translating', 'voicing')`, upload, lang, status, clip(failure, 300))
	return err
}

// ApprovedDubs lists a film's approved languages, for writing the player's track files.
func (st Store) ApprovedDubs(ctx context.Context, upload string) (showtime string, langs []string, err error) {
	if !uuidRe.MatchString(upload) {
		return "", nil, ErrNotFound
	}
	var sid *string
	if err := st.DB.QueryRow(ctx, `SELECT showtime_id FROM studio_premieres WHERE upload = $1`, upload).Scan(&sid); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", nil, err
	}
	if sid != nil {
		showtime = *sid
	}
	rows, err := st.DB.Query(ctx, `SELECT lang FROM studio_dubs WHERE upload = $1 AND status = 'approved' ORDER BY lang`, upload)
	if err != nil {
		return "", nil, err
	}
	langs, err = pgx.CollectRows(rows, pgx.RowTo[string])
	return showtime, langs, err
}
