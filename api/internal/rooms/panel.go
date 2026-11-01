package rooms

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

var (
	ErrNoPoll     = errors.New("that poll is not open")
	ErrBadPoll    = errors.New("invalid input: a poll needs a question and 2 to 4 answers")
	ErrNoParty    = errors.New("join or start a party to use the room")
	ErrTalkUsedUp = errors.New("your free talk time for this premiere is used up")
)

// FreeTalkSeconds is how much voice a free member gets per premiere.
const FreeTalkSeconds = 300

// Party is the viewer's own room at a premiere: the party they joined most recently.
type Party struct {
	ID      string   `json:"id"`
	Code    string   `json:"code"`
	Name    string   `json:"name"`
	Rules   []string `json:"rules"`
	Members []Friend `json:"members"`
}

// Friend is someone in the viewer's party. Online is filled in from the live hub.
type Friend struct {
	AccountID string `json:"-"`
	Name      string `json:"name"`
	Country   string `json:"country,omitempty"`
	Host      bool   `json:"host,omitempty"`
	Online    bool   `json:"online"`
	Me        bool   `json:"me,omitempty"`
}

// PartyFor returns the viewer's party for this premiere, or nil when they are not in one.
func (st Store) PartyFor(ctx context.Context, showtimeID, accountID string) (*Party, error) {
	var p Party
	err := st.DB.QueryRow(ctx, `SELECT p.id, p.code, p.name, p.rules FROM party_members m JOIN parties p ON p.id = m.party_id
	  WHERE m.account_id = $1 AND p.showtime_id = $2 ORDER BY m.joined_at DESC LIMIT 1`, accountID, showtimeID).Scan(&p.ID, &p.Code, &p.Name, &p.Rules)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	rows, err := st.DB.Query(ctx, `SELECT a.id, a.name, COALESCE(a.country, ''), a.id = p.host_id FROM party_members m
	  JOIN accounts a ON a.id = m.account_id JOIN parties p ON p.id = m.party_id
	  WHERE m.party_id = $1 ORDER BY a.id = p.host_id DESC, m.joined_at LIMIT 500`, p.ID)
	if err != nil {
		return nil, err
	}
	p.Members, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Friend, error) {
		var f Friend
		err := r.Scan(&f.AccountID, &f.Name, &f.Country, &f.Host)
		return f, err
	})
	return &p, err
}

// Source is a message as the translator needs it.
type Source struct {
	ID   int64  `json:"id"`
	Body string `json:"body"`
	Lang string `json:"lang"`
}

// Translations returns stored translations into lang, and the messages still missing one.
// Only messages of this premiere are considered, so ids from elsewhere are ignored.
func (st Store) Translations(ctx context.Context, showtimeID, lang string, ids []int64) (map[int64]string, []Source, error) {
	rows, err := st.DB.Query(ctx, `SELECT m.id, m.body, m.lang, t.body FROM room_messages m
	  LEFT JOIN room_translations t ON t.message_id = m.id AND t.lang = $2
	  WHERE m.showtime_id = $1 AND m.id = ANY($3) AND NOT m.hidden AND m.kind IN ('text', 'voice')`, showtimeID, lang, ids)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	done := map[int64]string{}
	var missing []Source
	for rows.Next() {
		var s Source
		var t *string
		if err := rows.Scan(&s.ID, &s.Body, &s.Lang, &t); err != nil {
			return nil, nil, err
		}
		if t != nil {
			done[s.ID] = *t
		} else {
			missing = append(missing, s)
		}
	}
	return done, missing, rows.Err()
}

// Translated is one machine translation to keep, with the spoiler verdict that came with it.
type Translated struct {
	ID      int64  `json:"id"`
	Body    string `json:"body"`
	Spoiler bool   `json:"spoiler"`
}

func (st Store) SaveTranslations(ctx context.Context, showtimeID, lang string, list []Translated) error {
	for _, t := range list {
		body := strings.TrimSpace(t.Body)
		if body == "" || utf8.RuneCountInString(body) > 2*MaxRunes {
			continue
		}
		if _, err := st.DB.Exec(ctx, `INSERT INTO room_translations (message_id, lang, body)
		  SELECT id, $3, $4 FROM room_messages WHERE id = $2 AND showtime_id = $1 ON CONFLICT DO NOTHING`, showtimeID, t.ID, lang, body); err != nil {
			return err
		}
		if t.Spoiler {
			if _, err := st.DB.Exec(ctx, `UPDATE room_messages SET spoiler = true WHERE id = $1 AND showtime_id = $2`, t.ID, showtimeID); err != nil {
				return err
			}
		}
	}
	return nil
}

type PollOption struct {
	Text  string `json:"text"`
	Votes int    `json:"votes"`
}

type Poll struct {
	ID        int64        `json:"id"`
	Scope     string       `json:"scope"` // room | world
	Question  string       `json:"question"`
	Options   []PollOption `json:"options"`
	Votes     int          `json:"votes"`
	Languages int          `json:"languages"`
	Mine      *int         `json:"mine,omitempty"` // the viewer's choice
	partyID   string
}

// WorldQuestion is the poll every premiere gets for the whole audience.
var WorldQuestion = struct {
	Q    string
	Opts []string
}{"Rate the opening", []string{"Loved it", "It was fine", "Not for me"}}

// Polls lists the world poll (made on first look) and the viewer's party polls.
func (st Store) Polls(ctx context.Context, showtimeID, partyID, viewerID string) ([]Poll, error) {
	if _, err := st.DB.Exec(ctx, `INSERT INTO room_polls (showtime_id, question, options) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
		showtimeID, WorldQuestion.Q, WorldQuestion.Opts); err != nil {
		return nil, err
	}
	rows, err := st.DB.Query(ctx, `SELECT p.id, p.party_id IS NOT NULL, p.question, p.options, COALESCE(p.party_id::text, '') FROM room_polls p
	  WHERE p.showtime_id = $1 AND (p.party_id IS NULL OR p.party_id = NULLIF($2, '')::uuid)
	  ORDER BY p.party_id IS NULL, p.id DESC LIMIT 20`, showtimeID, partyID)
	if err != nil {
		return nil, err
	}
	polls, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Poll, error) {
		var p Poll
		var room bool
		var opts []string
		err := r.Scan(&p.ID, &room, &p.Question, &opts, &p.partyID)
		p.Scope = "world"
		if room {
			p.Scope = "room"
		}
		for _, o := range opts {
			p.Options = append(p.Options, PollOption{Text: o})
		}
		return p, err
	})
	if err != nil {
		return nil, err
	}
	for i := range polls {
		if err := st.tally(ctx, &polls[i], viewerID); err != nil {
			return nil, err
		}
	}
	return polls, nil
}

func (st Store) tally(ctx context.Context, p *Poll, viewerID string) error {
	rows, err := st.DB.Query(ctx, `SELECT choice, count(*) FROM room_poll_votes WHERE poll_id = $1 GROUP BY choice`, p.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	p.Votes = 0
	for i := range p.Options {
		p.Options[i].Votes = 0
	}
	for rows.Next() {
		var c, n int
		if err := rows.Scan(&c, &n); err != nil {
			return err
		}
		if c >= 0 && c < len(p.Options) {
			p.Options[c].Votes = n
			p.Votes += n
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if err := st.DB.QueryRow(ctx, `SELECT count(DISTINCT lang) FILTER (WHERE lang <> '') FROM room_poll_votes WHERE poll_id = $1`, p.ID).Scan(&p.Languages); err != nil {
		return err
	}
	p.Mine = nil
	var mine int
	err = st.DB.QueryRow(ctx, `SELECT choice FROM room_poll_votes WHERE poll_id = $1 AND account_id = $2`, p.ID, viewerID).Scan(&mine)
	if err == nil {
		p.Mine = &mine
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	return nil
}

// CreatePoll starts a room poll in the viewer's party.
func (st Store) CreatePoll(ctx context.Context, showtimeID, partyID, accountID, question string, options []string) (Poll, error) {
	if partyID == "" {
		return Poll{}, ErrNoParty
	}
	question = strings.TrimSpace(question)
	var opts []string
	for _, o := range options {
		if o = strings.TrimSpace(o); o != "" {
			if utf8.RuneCountInString(o) > 60 {
				return Poll{}, ErrBadPoll
			}
			opts = append(opts, o)
		}
	}
	if question == "" || utf8.RuneCountInString(question) > 120 || len(opts) < 2 || len(opts) > 4 {
		return Poll{}, ErrBadPoll
	}
	var recent int
	if err := st.DB.QueryRow(ctx, `SELECT count(*) FROM room_polls WHERE created_by = $1 AND created_at > now() - interval '1 minute'`, accountID).Scan(&recent); err != nil {
		return Poll{}, err
	}
	if recent >= 2 {
		return Poll{}, ErrTooFast
	}
	p := Poll{Scope: "room", Question: question, partyID: partyID}
	if err := st.DB.QueryRow(ctx, `INSERT INTO room_polls (showtime_id, party_id, question, options, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
		showtimeID, partyID, question, opts, accountID).Scan(&p.ID); err != nil {
		return Poll{}, err
	}
	for _, o := range opts {
		p.Options = append(p.Options, PollOption{Text: o})
	}
	return p, nil
}

// Vote records (or changes) the viewer's answer and returns the fresh tally.
// Party polls only take votes from that party's members.
func (st Store) Vote(ctx context.Context, showtimeID, partyID, accountID, lang string, pollID int64, choice int) (Poll, error) {
	var p Poll
	var room bool
	var opts []string
	err := st.DB.QueryRow(ctx, `SELECT id, party_id IS NOT NULL, question, options, COALESCE(party_id::text, '') FROM room_polls
	  WHERE id = $1 AND showtime_id = $2 AND (party_id IS NULL OR party_id = NULLIF($3, '')::uuid)`, pollID, showtimeID, partyID).Scan(&p.ID, &room, &p.Question, &opts, &p.partyID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (choice < 0 || choice >= len(opts))) {
		return Poll{}, ErrNoPoll
	}
	if err != nil {
		return Poll{}, err
	}
	p.Scope = "world"
	if room {
		p.Scope = "room"
	}
	for _, o := range opts {
		p.Options = append(p.Options, PollOption{Text: o})
	}
	if _, err := st.DB.Exec(ctx, `INSERT INTO room_poll_votes (poll_id, account_id, choice, lang) VALUES ($1, $2, $3, $4)
	  ON CONFLICT (poll_id, account_id) DO UPDATE SET choice = EXCLUDED.choice, voted_at = now()`, pollID, accountID, choice, lang); err != nil {
		return Poll{}, err
	}
	return p, st.tally(ctx, &p, accountID)
}

// TalkLeft is how many seconds of voice the viewer has left at this premiere; -1 means unlimited.
func (st Store) TalkLeft(ctx context.Context, showtimeID, accountID, plan string) (int, error) {
	if plan != "free" && plan != "" {
		return -1, nil
	}
	var used int
	err := st.DB.QueryRow(ctx, `SELECT seconds FROM talk_time WHERE account_id = $1 AND showtime_id = $2`, accountID, showtimeID).Scan(&used)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return 0, err
	}
	return max(0, FreeTalkSeconds-used), nil
}

// UseTalk spends voice seconds. Free members are refused once the allowance would run out.
func (st Store) UseTalk(ctx context.Context, showtimeID, accountID, plan string, seconds int) (int, error) {
	seconds = max(1, seconds)
	if (plan == "free" || plan == "") && seconds > FreeTalkSeconds {
		return 0, ErrTalkUsedUp
	}
	if plan != "free" && plan != "" {
		_, err := st.DB.Exec(ctx, `INSERT INTO talk_time (account_id, showtime_id, seconds) VALUES ($1, $2, $3)
		  ON CONFLICT (account_id, showtime_id) DO UPDATE SET seconds = talk_time.seconds + EXCLUDED.seconds`, accountID, showtimeID, seconds)
		return -1, err
	}
	var used int
	err := st.DB.QueryRow(ctx, `INSERT INTO talk_time (account_id, showtime_id, seconds) VALUES ($1, $2, $3)
	  ON CONFLICT (account_id, showtime_id) DO UPDATE SET seconds = talk_time.seconds + EXCLUDED.seconds
	  WHERE talk_time.seconds + EXCLUDED.seconds <= $4 RETURNING seconds`, accountID, showtimeID, seconds, FreeTalkSeconds).Scan(&used)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrTalkUsedUp
	}
	return FreeTalkSeconds - used, err
}

// Muted reports whether a free member has used all their talk time at this premiere. From then
// on they can react but not message the room (Figma "Web / Player · Free talk time used", 28:565).
func (st Store) Muted(ctx context.Context, showtimeID, accountID string) (bool, error) {
	var muted bool
	err := st.DB.QueryRow(ctx, `SELECT a.plan = 'free' AND coalesce((SELECT seconds FROM talk_time t WHERE t.account_id = a.id AND t.showtime_id = $2), 0) >= $3
	  FROM accounts a WHERE a.id = $1`, accountID, showtimeID, FreeTalkSeconds).Scan(&muted)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return muted, err
}
