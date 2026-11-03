package exec

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// Notifications and re-engagement (Figma 51:375). The CEO and the CMO send announcements to
// members in the app (a "news" notification) and by email to members who keep "New features and
// updates" email switched on. Emails go out from the web service, which owns the email layout.

type Campaign struct {
	ID       int64     `json:"id"`
	Title    string    `json:"title"`
	Body     string    `json:"body"`
	Link     string    `json:"link"`
	Audience string    `json:"audience"`
	Country  string    `json:"country"`
	Channels []string  `json:"channels"`
	Status   string    `json:"status"`
	SendAt   time.Time `json:"sendAt"`
	TestSent int       `json:"testSent"`
	Sent     int       `json:"sent"`
	Emailed  int       `json:"emailed"`
	Opened   int       `json:"opened"`
	Booked   int       `json:"booked"` // recipients who bought a seat within 24 hours
	Langs    int       `json:"langs"`
}

// Automatic is a notification the platform sends by itself (premiere reminders, friends' rooms).
type Automatic struct {
	Kind   string `json:"kind"`
	Sent   int    `json:"sent"`
	Opened int    `json:"opened"`
}

type CampaignsPage struct {
	SentToday   int         `json:"sentToday"`
	Sent30      int         `json:"sent30"`
	Opened30    int         `json:"opened30"`
	Booked30    int         `json:"booked30"`
	Members     int         `json:"members"`
	EmailOff    int         `json:"emailOff"`
	Campaigns   []Campaign  `json:"campaigns"`
	Automatic   []Automatic `json:"automatic"`
	Languages   []LangCount `json:"languages"`
	CountryList []string    `json:"countryList"`
}

type LangCount struct {
	Lang    string `json:"lang"`
	Members int    `json:"members"`
}

// Recipient is one member a campaign email goes to, with the text in their language.
type Recipient struct {
	Email string `json:"email"`
	Name  string `json:"name"`
	Title string `json:"title"`
	Body  string `json:"body"`
}

// Batch is a campaign the web service still has to email.
type Batch struct {
	Campaign   Campaign    `json:"campaign"`
	Members    int         `json:"members"`
	Recipients []Recipient `json:"recipients"`
}

// Members a campaign can reach: not being deleted and not banned.
const reachable = `a.delete_after IS NULL AND a.banned_at IS NULL`

func audienceSQL(audience string) string {
	switch audience {
	case "lapsed":
		return reachable + ` AND a.created_at < $1::timestamptz - interval '30 days'
		  AND NOT EXISTS (SELECT 1 FROM holds h WHERE h.account_id = a.id AND h.status = 'paid' AND h.created_at >= $1::timestamptz - interval '30 days')`
	case "country":
		return reachable + ` AND a.country = $2`
	}
	return reachable
}

func (st Store) Campaigns(ctx context.Context, email string, now time.Time) (CampaignsPage, error) {
	p := CampaignsPage{Campaigns: []Campaign{}, Automatic: []Automatic{}, Languages: []LangCount{}, CountryList: []string{}}
	if err := st.allowed(ctx, email, "cmo"); err != nil {
		return p, err
	}
	day := now.Truncate(24 * time.Hour)
	from := now.AddDate(0, 0, -30)
	if err := st.DB.QueryRow(ctx, `SELECT
	    (SELECT count(*) FROM notifications WHERE campaign_id IS NOT NULL AND created_at >= $1)::int
	      + coalesce((SELECT sum(emailed) FROM exec_campaigns WHERE sent_at >= $1), 0)::int,
	    (SELECT count(*) FROM notifications WHERE campaign_id IS NOT NULL AND created_at >= $2)::int,
	    (SELECT count(*) FROM notifications WHERE campaign_id IS NOT NULL AND created_at >= $2 AND read_at IS NOT NULL)::int,
	    (SELECT count(*) FROM notifications n WHERE n.campaign_id IS NOT NULL AND n.created_at >= $2 AND EXISTS
	      (SELECT 1 FROM holds h WHERE h.account_id = n.account_id AND h.status = 'paid' AND h.created_at BETWEEN n.created_at AND n.created_at + interval '1 day'))::int,
	    (SELECT count(*) FROM accounts a WHERE `+reachable+`)::int,
	    (SELECT count(*) FROM accounts a WHERE `+reachable+` AND a.prefs->>'n.features.email' = 'false')::int`, day, from).
		Scan(&p.SentToday, &p.Sent30, &p.Opened30, &p.Booked30, &p.Members, &p.EmailOff); err != nil {
		return p, err
	}
	rows, err := st.DB.Query(ctx, `SELECT c.id, c.title, c.body, c.link, c.audience, c.country, c.channels, c.status, c.send_at, c.test_sent, c.sent, c.emailed,
	    (SELECT count(*) FROM notifications n WHERE n.campaign_id = c.id AND n.read_at IS NOT NULL)::int,
	    (SELECT count(*) FROM notifications n WHERE n.campaign_id = c.id AND EXISTS
	      (SELECT 1 FROM holds h WHERE h.account_id = n.account_id AND h.status = 'paid' AND h.created_at BETWEEN n.created_at AND n.created_at + interval '1 day'))::int,
	    (SELECT count(*) FROM exec_campaign_texts t WHERE t.campaign_id = c.id)::int
	  FROM exec_campaigns c ORDER BY c.created_at DESC LIMIT 30`)
	if err != nil {
		return p, err
	}
	if p.Campaigns, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Campaign, error) {
		var c Campaign
		return c, r.Scan(&c.ID, &c.Title, &c.Body, &c.Link, &c.Audience, &c.Country, &c.Channels, &c.Status, &c.SendAt, &c.TestSent, &c.Sent, &c.Emailed, &c.Opened, &c.Booked, &c.Langs)
	}); err != nil {
		return p, err
	}
	rows, err = st.DB.Query(ctx, `SELECT kind, count(*)::int, count(read_at)::int FROM notifications
	  WHERE campaign_id IS NULL AND kind IN ('premiere', 'party', 'friend', 'lottery', 'gift') AND created_at >= $1 GROUP BY 1 ORDER BY 2 DESC`, from)
	if err != nil {
		return p, err
	}
	if p.Automatic, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Automatic, error) {
		var a Automatic
		return a, r.Scan(&a.Kind, &a.Sent, &a.Opened)
	}); err != nil {
		return p, err
	}
	rows, err = st.DB.Query(ctx, `SELECT coalesce(nullif(a.app_language, ''), 'en'), count(*)::int FROM accounts a WHERE `+reachable+` GROUP BY 1 ORDER BY 2 DESC LIMIT 60`)
	if err != nil {
		return p, err
	}
	if p.Languages, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (LangCount, error) {
		var l LangCount
		return l, r.Scan(&l.Lang, &l.Members)
	}); err != nil {
		return p, err
	}
	rows, err = st.DB.Query(ctx, `SELECT DISTINCT country FROM accounts a WHERE `+reachable+` AND country IS NOT NULL ORDER BY 1`)
	if err != nil {
		return p, err
	}
	p.CountryList, err = pgx.CollectRows(rows, pgx.RowTo[string])
	return p, err
}

var (
	linkRe = regexp.MustCompile(`^/[A-Za-z0-9/_?=&.-]*$`)
	langRe = regexp.MustCompile(`^[a-z]{2,3}(-[A-Za-z]{2,4})?$`)
)

// Text is a translation of a campaign into one app language.
type Text struct {
	Lang  string `json:"lang"`
	Title string `json:"title"`
	Body  string `json:"body"`
}

// SaveCampaign stores a new campaign, scheduled for sendAt (now or later), with its translations.
func (st Store) SaveCampaign(ctx context.Context, email string, c Campaign, texts []Text, now time.Time) (Campaign, error) {
	if err := st.allowed(ctx, email, "cmo"); err != nil {
		return c, err
	}
	c.Title, c.Body, c.Link = strings.TrimSpace(c.Title), strings.TrimSpace(c.Body), strings.TrimSpace(c.Link)
	c.Country = strings.ToUpper(strings.TrimSpace(c.Country))
	bad := func(msg string) (Campaign, error) { return c, fmt.Errorf("%w: %s", ErrBadInput, msg) }
	chans := []string{}
	for _, ch := range c.Channels {
		if (ch == "inapp" || ch == "email") && !strings.Contains(strings.Join(chans, ","), ch) {
			chans = append(chans, ch)
		}
	}
	c.Channels = chans
	switch {
	case utf8.RuneCountInString(c.Title) < 3 || utf8.RuneCountInString(c.Title) > 120:
		return bad("a title of 3 to 120 characters")
	case utf8.RuneCountInString(c.Body) > 300:
		return bad("keep the message under 300 characters")
	case c.Link != "" && !linkRe.MatchString(c.Link):
		return bad("the link must be a page on E-Cinema, like /coming-soon")
	case c.Audience != "everyone" && c.Audience != "lapsed" && c.Audience != "country":
		return bad("pick who it goes to")
	case c.Audience == "country" && !countryRe.MatchString(c.Country):
		return bad("pick a country")
	case len(c.Channels) == 0:
		return bad("pick in-app, email or both")
	case len(texts) > 60:
		return bad("too many translations")
	}
	if c.Audience != "country" {
		c.Country = ""
	}
	if c.SendAt.IsZero() || c.SendAt.Before(now) {
		c.SendAt = now
	}
	if c.SendAt.After(now.AddDate(0, 3, 0)) {
		return bad("schedule it within the next three months")
	}
	tx, err := st.DB.Begin(ctx)
	if err != nil {
		return c, err
	}
	defer tx.Rollback(ctx)
	if err := tx.QueryRow(ctx, `INSERT INTO exec_campaigns (title, body, link, audience, country, channels, send_at, created_by)
	  VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, status`, c.Title, c.Body, c.Link, c.Audience, c.Country, c.Channels, c.SendAt, strings.ToLower(email)).Scan(&c.ID, &c.Status); err != nil {
		return c, err
	}
	for _, t := range texts {
		t.Title, t.Body = strings.TrimSpace(t.Title), strings.TrimSpace(t.Body)
		if !langRe.MatchString(t.Lang) || t.Lang == "en" || t.Title == "" || utf8.RuneCountInString(t.Title) > 120 || utf8.RuneCountInString(t.Body) > 300 {
			continue
		}
		if _, err := tx.Exec(ctx, `INSERT INTO exec_campaign_texts (campaign_id, lang, title, body) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, c.ID, t.Lang, t.Title, t.Body); err != nil {
			return c, err
		}
		c.Langs++
	}
	return c, tx.Commit(ctx)
}

// CancelCampaign stops a scheduled campaign before it goes out.
func (st Store) CancelCampaign(ctx context.Context, email string, id int64) error {
	if err := st.allowed(ctx, email, "cmo"); err != nil {
		return err
	}
	tag, err := st.DB.Exec(ctx, `UPDATE exec_campaigns SET status = 'cancelled' WHERE id = $1 AND status = 'scheduled'`, id)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

// TestCampaign sends a scheduled campaign to a random 1% of its audience (at least one member)
// in the app and returns who to email. The full send later skips them.
func (st Store) TestCampaign(ctx context.Context, email string, id int64, now time.Time) (Batch, error) {
	if err := st.allowed(ctx, email, "cmo"); err != nil {
		return Batch{}, err
	}
	return st.deliver(ctx, id, true, now)
}

// DueCampaigns claims every scheduled campaign whose time has come, delivers it in the app and
// returns the emails still to send. The web service calls it every minute.
func (st Store) DueCampaigns(ctx context.Context, now time.Time) ([]Batch, error) {
	rows, err := st.DB.Query(ctx, `UPDATE exec_campaigns SET status = 'sending' WHERE status = 'scheduled' AND send_at <= $1 RETURNING id`, now)
	if err != nil {
		return nil, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[int64])
	if err != nil {
		return nil, err
	}
	out := []Batch{}
	for _, id := range ids {
		b, err := st.deliver(ctx, id, false, now)
		if err != nil {
			return out, err
		}
		out = append(out, b)
	}
	return out, nil
}

func (st Store) deliver(ctx context.Context, id int64, test bool, now time.Time) (Batch, error) {
	var b Batch
	c := &b.Campaign
	err := st.DB.QueryRow(ctx, `SELECT id, title, body, link, audience, country, channels, status, send_at FROM exec_campaigns WHERE id = $1`, id).
		Scan(&c.ID, &c.Title, &c.Body, &c.Link, &c.Audience, &c.Country, &c.Channels, &c.Status, &c.SendAt)
	if err == pgx.ErrNoRows {
		return b, ErrNotFound
	}
	if err != nil {
		return b, err
	}
	if test && c.Status != "scheduled" {
		return b, fmt.Errorf("%w: only a campaign that has not gone out can be tested", ErrBadInput)
	}
	// Pick the members: everyone in the audience not yet reached by this campaign, or for a test
	// 1% of them at random. Each gets the text in their app language when Claude translated it.
	pick := `SELECT a.id, a.email, coalesce(a.name, ''), coalesce(t.title, c.title), coalesce(t.body, c.body),
	    coalesce(a.prefs->>'n.features.email', 'true') <> 'false'
	  FROM accounts a CROSS JOIN exec_campaigns c
	  LEFT JOIN exec_campaign_texts t ON t.campaign_id = c.id AND t.lang = a.app_language
	  WHERE c.id = $3 AND $1::timestamptz IS NOT NULL AND $2::text IS NOT NULL AND ` + audienceSQL(c.Audience) + `
	    AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.account_id = a.id AND n.campaign_id = c.id)`
	if test {
		pick += ` ORDER BY random() LIMIT greatest(1, ceil((SELECT count(*) FROM accounts a WHERE ` + audienceSQL(c.Audience) + `) * 0.01))`
	}
	rows, err := st.DB.Query(ctx, pick, now, c.Country, c.ID)
	if err != nil {
		return b, err
	}
	type member struct {
		id, email, name, title, body string
		mail                         bool
	}
	ms, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (member, error) {
		var m member
		return m, r.Scan(&m.id, &m.email, &m.name, &m.title, &m.body, &m.mail)
	})
	if err != nil {
		return b, err
	}
	inapp, mail := false, false
	for _, ch := range c.Channels {
		inapp, mail = inapp || ch == "inapp", mail || ch == "email"
	}
	b.Recipients = []Recipient{}
	batch := &pgx.Batch{}
	for _, m := range ms {
		// The notification row also marks the member as reached, so it is stored for email-only
		// campaigns too, already read.
		readAt := any(nil)
		if !inapp {
			readAt = now
		}
		batch.Queue(`INSERT INTO notifications (account_id, kind, title, body, link, campaign_id, dedupe, read_at) VALUES ($1, 'news', $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
			m.id, truncate(m.title, 120), truncate(m.body, 300), c.Link, c.ID, fmt.Sprintf("campaign:%d", c.ID), readAt)
		if mail && m.mail {
			b.Recipients = append(b.Recipients, Recipient{Email: m.email, Name: m.name, Title: m.title, Body: m.body})
		}
	}
	if err := st.DB.SendBatch(ctx, batch).Close(); err != nil {
		return b, err
	}
	b.Members = len(ms)
	n := 0
	if inapp {
		n = len(ms)
	}
	if test {
		_, err = st.DB.Exec(ctx, `UPDATE exec_campaigns SET test_sent = test_sent + $2 WHERE id = $1`, c.ID, len(ms))
	} else {
		_, err = st.DB.Exec(ctx, `UPDATE exec_campaigns SET status = 'sent', sent = sent + $2, sent_at = $3 WHERE id = $1`, c.ID, n, now)
	}
	return b, err
}

func truncate(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}

// CampaignEmailed records how many emails the web service sent for a campaign.
func (st Store) CampaignEmailed(ctx context.Context, id int64, n int) error {
	_, err := st.DB.Exec(ctx, `UPDATE exec_campaigns SET emailed = emailed + $2 WHERE id = $1`, id, n)
	return err
}
