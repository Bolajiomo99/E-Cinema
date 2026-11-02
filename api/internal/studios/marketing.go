package studios

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// ---- Marketing (Figma 39:779) ----
// A campaign is a tracked link to one screening. Each visit through it counts as reach, and
// seats bought by someone who arrived through it are counted against it.

var ErrNoCampaign = errors.New("no such campaign")

type Campaign struct {
	ID         string    `json:"id"`
	ShowtimeID string    `json:"showtimeId"`
	Film       string    `json:"film"`
	Name       string    `json:"name"`
	Channel    string    `json:"channel"`
	Code       string    `json:"code"`
	CostCents  int64     `json:"costCents"`
	Clicks     int       `json:"clicks"`
	Orders     int       `json:"orders"`
	Seats      int       `json:"seats"`
	GrossCents int64     `json:"grossCents"`
	CreatedAt  time.Time `json:"createdAt"`
}

type CampaignInput struct {
	ShowtimeID string `json:"showtimeId"`
	Name       string `json:"name"`
	Channel    string `json:"channel"`
	CostCents  int64  `json:"costCents"`
}

var channels = map[string]bool{"clips": true, "tiktok": true, "instagram": true, "youtube": true, "x": true, "facebook": true, "whatsapp": true, "email": true, "creator": true, "other": true}

// marketer is the caller's studio when their role may run campaigns.
func (st Store) marketer(ctx context.Context, acct, email string, write bool) (Studio, error) {
	s, err := st.verified(ctx, acct, email, false)
	if err != nil {
		return s, err
	}
	if write && !can(s.Role, "marketing") {
		return s, ErrForbidden
	}
	return s, nil
}

const campaignSelect = `SELECT c.id, c.showtime_id, s.film, c.name, c.channel, c.code, c.cost_cents, c.clicks,
  count(h.id) FILTER (WHERE h.status = 'paid'), coalesce(sum(h.seats) FILTER (WHERE h.status = 'paid'), 0),
  coalesce(sum(` + netExpr + `) FILTER (WHERE h.status = 'paid'), 0), c.created_at
  FROM studio_campaigns c JOIN showtimes s ON s.id = c.showtime_id LEFT JOIN holds h ON h.campaign_id = c.id`

func scanCampaign(r pgx.CollectableRow) (Campaign, error) {
	var c Campaign
	err := r.Scan(&c.ID, &c.ShowtimeID, &c.Film, &c.Name, &c.Channel, &c.Code, &c.CostCents, &c.Clicks, &c.Orders, &c.Seats, &c.GrossCents, &c.CreatedAt)
	return c, err
}

func (st Store) Campaigns(ctx context.Context, acct, email string) ([]Campaign, error) {
	s, err := st.marketer(ctx, acct, email, false)
	if err != nil {
		return nil, err
	}
	rows, err := st.DB.Query(ctx, campaignSelect+` WHERE c.studio = $1 GROUP BY c.id, s.id ORDER BY c.created_at DESC LIMIT 100`, s.Name)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanCampaign)
}

func newCode() string {
	const alphabet = "abcdefghijkmnpqrstuvwxyz23456789"
	b := make([]byte, 8)
	rand.Read(b)
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(b)
}

func (st Store) CreateCampaign(ctx context.Context, acct, email string, in CampaignInput) (Campaign, error) {
	s, err := st.marketer(ctx, acct, email, true)
	if err != nil {
		return Campaign{}, err
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" || len([]rune(in.Name)) > 80 || !channels[in.Channel] || in.CostCents < 0 || in.CostCents > 1e12 {
		return Campaign{}, ErrBadInput
	}
	var n int
	if err := st.DB.QueryRow(ctx, `SELECT count(*) FROM studio_campaigns WHERE studio = $1`, s.Name).Scan(&n); err != nil {
		return Campaign{}, err
	}
	if n >= 200 {
		return Campaign{}, fmt.Errorf("%w: a studio can keep up to 200 campaigns", ErrBadInput)
	}
	var id string
	err = st.DB.QueryRow(ctx, `INSERT INTO studio_campaigns (studio, showtime_id, name, channel, code, cost_cents, created_by)
	  SELECT $1, s.id, $3, $4, $5, $6, $7 FROM showtimes s WHERE s.id = $2 AND s.studio = $1 RETURNING id`,
		s.Name, in.ShowtimeID, in.Name, in.Channel, newCode(), in.CostCents, acct).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return Campaign{}, ErrBadInput
	}
	if err != nil {
		return Campaign{}, err
	}
	return st.campaign(ctx, s.Name, id)
}

func (st Store) campaign(ctx context.Context, studio, id string) (Campaign, error) {
	if !uuidRe.MatchString(id) {
		return Campaign{}, ErrNoCampaign
	}
	rows, err := st.DB.Query(ctx, campaignSelect+` WHERE c.studio = $1 AND c.id = $2 GROUP BY c.id, s.id`, studio, id)
	if err != nil {
		return Campaign{}, err
	}
	c, err := pgx.CollectExactlyOneRow(rows, scanCampaign)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, ErrNoCampaign
	}
	return c, err
}

// SetCampaignCost records what a campaign cost, so the page can show cost per seat.
func (st Store) SetCampaignCost(ctx context.Context, acct, email, id string, cents int64) (Campaign, error) {
	s, err := st.marketer(ctx, acct, email, true)
	if err != nil {
		return Campaign{}, err
	}
	if cents < 0 || cents > 1e12 || !uuidRe.MatchString(id) {
		return Campaign{}, ErrBadInput
	}
	tag, err := st.DB.Exec(ctx, `UPDATE studio_campaigns SET cost_cents = $3 WHERE studio = $1 AND id = $2`, s.Name, id, cents)
	if err != nil {
		return Campaign{}, err
	}
	if tag.RowsAffected() == 0 {
		return Campaign{}, ErrNoCampaign
	}
	return st.campaign(ctx, s.Name, id)
}

func (st Store) DeleteCampaign(ctx context.Context, acct, email, id string) error {
	s, err := st.marketer(ctx, acct, email, true)
	if err != nil {
		return err
	}
	if !uuidRe.MatchString(id) {
		return ErrNoCampaign
	}
	tag, err := st.DB.Exec(ctx, `DELETE FROM studio_campaigns WHERE studio = $1 AND id = $2`, s.Name, id)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNoCampaign
	}
	return err
}

// CampaignVisit counts one visit through a campaign link and says which screening it is for.
func (st Store) CampaignVisit(ctx context.Context, code string) (string, error) {
	var showtime string
	err := st.DB.QueryRow(ctx, `UPDATE studio_campaigns SET clicks = clicks + 1 WHERE code = $1 RETURNING showtime_id`, code).Scan(&showtime)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNoCampaign
	}
	return showtime, err
}

// Attribute links a new seat hold to the campaign its buyer arrived through, when the campaign
// is for the same screening.
func (st Store) Attribute(ctx context.Context, holdID, code string) error {
	if code == "" || len(code) != 8 {
		return nil
	}
	_, err := st.DB.Exec(ctx, `UPDATE holds h SET campaign_id = c.id FROM studio_campaigns c
	  WHERE h.id = $1 AND c.code = $2 AND c.showtime_id = h.showtime_id AND h.campaign_id IS NULL`, holdID, code)
	return err
}

// ---- AI clip moments ----

type Clip struct {
	Idx      int    `json:"idx"`
	StartMs  int    `json:"startMs"`
	EndMs    int    `json:"endMs"`
	Title    string `json:"title"`
	Why      string `json:"why"`
	Format   string `json:"format"`
	Approved bool   `json:"approved"`
}

type Clips struct {
	CutoffMs int    `json:"cutoffMs"`
	Clips    []Clip `json:"clips"`
}

func (st Store) Clips(ctx context.Context, acct, email, upload string) (Clips, error) {
	s, err := st.marketer(ctx, acct, email, false)
	if err != nil {
		return Clips{}, err
	}
	if _, err := st.upload(ctx, s.Name, upload); err != nil {
		return Clips{}, err
	}
	return st.clips(ctx, upload)
}

func (st Store) clips(ctx context.Context, upload string) (Clips, error) {
	out := Clips{Clips: []Clip{}}
	if err := st.DB.QueryRow(ctx, `SELECT clip_cutoff_ms FROM studio_uploads WHERE id = $1`, upload).Scan(&out.CutoffMs); err != nil {
		return out, err
	}
	rows, err := st.DB.Query(ctx, `SELECT idx, start_ms, end_ms, title, why, format, approved FROM studio_clips WHERE upload = $1 ORDER BY idx`, upload)
	if err != nil {
		return out, err
	}
	out.Clips, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Clip, error) {
		var c Clip
		err := r.Scan(&c.Idx, &c.StartMs, &c.EndMs, &c.Title, &c.Why, &c.Format, &c.Approved)
		return c, err
	})
	return out, err
}

// SaveClips replaces a film's clip moments (what Studio AI picked) and the spoiler cutoff.
func (st Store) SaveClips(ctx context.Context, acct, email, upload string, cutoffMs int, clips []Clip) (Clips, error) {
	s, err := st.marketer(ctx, acct, email, true)
	if err != nil {
		return Clips{}, err
	}
	if _, err := st.upload(ctx, s.Name, upload); err != nil {
		return Clips{}, err
	}
	if cutoffMs < 0 || len(clips) > 12 {
		return Clips{}, ErrBadInput
	}
	for i, c := range clips {
		c.Title = strings.TrimSpace(c.Title)
		if c.StartMs < 0 || c.EndMs <= c.StartMs || c.EndMs-c.StartMs > 60000 || c.EndMs > cutoffMs || c.Title == "" || len([]rune(c.Title)) > 40 || len([]rune(c.Why)) > 200 ||
			(c.Format != "9:16" && c.Format != "1:1" && c.Format != "16:9") {
			return Clips{}, ErrBadInput
		}
		clips[i] = c
	}
	err = pgx.BeginFunc(ctx, st.DB, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE studio_uploads SET clip_cutoff_ms = $2 WHERE id = $1`, upload, cutoffMs); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM studio_clips WHERE upload = $1`, upload); err != nil {
			return err
		}
		for i, c := range clips {
			if _, err := tx.Exec(ctx, `INSERT INTO studio_clips (upload, idx, start_ms, end_ms, title, why, format) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
				upload, i, c.StartMs, c.EndMs, c.Title, c.Why, c.Format); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return Clips{}, err
	}
	return st.clips(ctx, upload)
}

// ApproveClips marks the chosen moments approved (and the rest not).
func (st Store) ApproveClips(ctx context.Context, acct, email, upload string, idx []int) (Clips, error) {
	s, err := st.marketer(ctx, acct, email, true)
	if err != nil {
		return Clips{}, err
	}
	if _, err := st.upload(ctx, s.Name, upload); err != nil {
		return Clips{}, err
	}
	if _, err := st.DB.Exec(ctx, `UPDATE studio_clips SET approved = idx = ANY($2) WHERE upload = $1`, upload, idx); err != nil {
		return Clips{}, err
	}
	return st.clips(ctx, upload)
}
