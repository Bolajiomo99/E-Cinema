package studios

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
)

// FilmCode is the short reference a studio quotes for a film (email 44): "Orbit Zero" with
// upload 8a1f… → FLM-OZ-2207. The digits come from the upload id, so the code never changes.
func FilmCode(title, uploadID string) string {
	initials := ""
	for _, w := range strings.Fields(title) {
		for _, r := range w {
			if unicode.IsLetter(r) || unicode.IsDigit(r) {
				initials += string(unicode.ToUpper(r))
				break
			}
		}
		if len([]rune(initials)) == 2 {
			break
		}
	}
	if initials == "" {
		initials = "X"
	}
	h := strings.ReplaceAll(uploadID, "-", "")
	n, _ := strconv.ParseUint(h[:min(8, len(h))], 16, 64)
	return fmt.Sprintf("FLM-%s-%04d", initials, n%10000)
}

// FilmIssues lists what the quality checks found still wrong with a film's files and details:
// file checks marked "warn" (the age rating suggestion aside), files that failed to read, and a
// missing age rating.
func FilmIssues(files []UploadFile, ageRating string) []string {
	var out []string
	for _, f := range files {
		if f.Status == "failed" {
			out = append(out, f.Name+" could not be read, so upload it again")
			continue
		}
		for _, c := range f.Checks {
			if c.State == "warn" && !strings.HasPrefix(c.Text, "Age rating") {
				out = append(out, strings.TrimRight(c.Text, ". "))
			}
		}
	}
	if strings.TrimSpace(ageRating) == "" {
		out = append(out, "the age rating is missing")
	}
	return out
}

// QueueFilmChanges queues email 44 (Figma 127:457) to the studio owner for each film with a
// premiere still ahead whose checks found something to fix. The same set of problems is sent
// once; a new problem sends a new email.
func (st Store) QueueFilmChanges(ctx context.Context, now time.Time) (int, error) {
	rows, err := st.DB.Query(ctx, `SELECT u.id, u.title, u.age_rating, u.studio, s.starts_at,
	    (SELECT m.email FROM studio_members m WHERE m.studio = u.studio AND m.role = 'owner' ORDER BY m.added_at LIMIT 1)
	  FROM studio_premieres p JOIN studio_uploads u ON u.id = p.upload JOIN showtimes s ON s.id = p.showtime_id
	  WHERE p.published_at IS NOT NULL AND s.withdrawn_at IS NULL AND s.starts_at > $1`, now)
	if err != nil {
		return 0, err
	}
	type film struct {
		id, title, age, studio string
		starts                 time.Time
		owner                  *string
	}
	var films []film
	for rows.Next() {
		var f film
		if err := rows.Scan(&f.id, &f.title, &f.age, &f.studio, &f.starts, &f.owner); err != nil {
			rows.Close()
			return 0, err
		}
		films = append(films, f)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	n := 0
	for _, f := range films {
		if f.owner == nil {
			continue
		}
		files, err := st.files(ctx, f.id)
		if err != nil {
			return n, err
		}
		issues := FilmIssues(files, f.age)
		if len(issues) == 0 {
			continue
		}
		sorted := append([]string(nil), issues...)
		sort.Strings(sorted)
		sum := sha256.Sum256([]byte(strings.Join(sorted, "\n")))
		data, _ := json.Marshal(map[string]any{"film": f.title, "code": FilmCode(f.title, f.id), "upload": f.id, "issues": issues, "startsAt": f.starts})
		tag, err := st.DB.Exec(ctx, `INSERT INTO mail_outbox (kind, to_email, to_name, data, dedupe) VALUES ('film_changes', $1, $2, $3, $4) ON CONFLICT (dedupe) DO NOTHING`,
			*f.owner, f.studio, string(data), "filmqa:"+f.id+":"+hex.EncodeToString(sum[:8]))
		if err != nil {
			return n, err
		}
		n += int(tag.RowsAffected())
	}
	return n, nil
}
