package tickets

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
)

// Sold-out lottery (Figma 31:1121). One free seat per SeatsPerFree sold opens by lottery,
// drawn DrawBefore the film. Winners have ClaimFor to take their seat, and pay nothing.
const (
	SeatsPerFree = 40
	DrawBefore   = time.Hour
	ClaimFor     = 30 * time.Minute
)

var (
	ErrNotSoldOut  = errors.New("this premiere still has seats; buy one instead")
	ErrDrawClosed  = errors.New("the draw has closed")
	ErrNotVerified = errors.New("one verified account, one entry: verify your phone or ID first")
	ErrHasTicket   = errors.New("you already have a seat for this premiere")
	ErrNoWin       = errors.New("no free seat to claim, or the 30 minutes have passed")
)

type Lottery struct {
	ShowtimeID   string     `json:"showtimeId"`
	SoldOut      bool       `json:"soldOut"`
	SoldOutAfter int        `json:"soldOutAfterMin"` // minutes from the first sale to the last seat
	Sold         int        `json:"sold"`
	FreeSeats    int        `json:"freeSeats"`
	Entries      int        `json:"entries"`
	MyEntry      int64      `json:"myEntry,omitempty"`
	DrawAt       time.Time  `json:"drawAt"`
	Drawn        bool       `json:"drawn"`
	Won          bool       `json:"won"`
	WinHoldID    string     `json:"winHoldId,omitempty"`
	WinExpiresAt *time.Time `json:"winExpiresAt,omitempty"`
	SeedHash     string     `json:"seedHash"`
	Seed         string     `json:"seed,omitempty"` // published after the draw
	Waitlisted   bool       `json:"waitlisted"`
	HasTicket    bool       `json:"hasTicket"`
}

// Winner is someone the draw picked, for the "you won" email.
type Winner struct {
	AccountID string `json:"accountId"`
	Email     string `json:"email"`
	Name      string `json:"name"`
	HoldID    string `json:"holdId"`
}

func freeSeats(capacity int) int {
	if n := capacity / SeatsPerFree; n > 0 {
		return n
	}
	return 1
}

// LotteryState is what the sold-out page shows. accountID may be empty for a guest.
func (st Store) LotteryState(ctx context.Context, showtimeID, accountID string) (Lottery, error) {
	l := Lottery{ShowtimeID: showtimeID}
	var capacity, sold int
	var starts time.Time
	var first, last *time.Time
	err := st.DB.QueryRow(ctx, `SELECT s.capacity, s.starts_at,
	    COALESCE((SELECT sum(seats) FROM holds h WHERE h.showtime_id = s.id AND NOT h.lottery AND (h.status = 'paid' OR (h.status = 'held' AND h.expires_at > now()))), 0),
	    (SELECT min(created_at) FROM holds h WHERE h.showtime_id = s.id AND h.status = 'paid' AND NOT h.lottery),
	    (SELECT max(created_at) FROM holds h WHERE h.showtime_id = s.id AND h.status = 'paid' AND NOT h.lottery)
	  FROM showtimes s WHERE s.id = $1`, showtimeID).Scan(&capacity, &starts, &sold, &first, &last)
	if errors.Is(err, pgx.ErrNoRows) {
		return l, ErrNotFound
	}
	if err != nil {
		return l, err
	}
	l.Sold, l.SoldOut, l.FreeSeats, l.DrawAt = sold, sold >= capacity, freeSeats(capacity), starts.Add(-DrawBefore)
	if first != nil && last != nil {
		l.SoldOutAfter = int(last.Sub(*first).Minutes())
	}
	if l.SoldOut {
		seed := make([]byte, 32)
		if _, err := rand.Read(seed); err != nil {
			return l, err
		}
		h := sha256.Sum256(seed)
		if _, err := st.DB.Exec(ctx, `INSERT INTO lottery_draws (showtime_id, seed, seed_hash) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, showtimeID, seed, h[:]); err != nil {
			return l, err
		}
	}
	var seed, hash []byte
	var drawn *time.Time
	if err := st.DB.QueryRow(ctx, `SELECT seed, seed_hash, drawn_at FROM lottery_draws WHERE showtime_id = $1`, showtimeID).Scan(&seed, &hash, &drawn); err == nil {
		l.SeedHash, l.Drawn = hex.EncodeToString(hash), drawn != nil
		if l.Drawn {
			l.Seed = hex.EncodeToString(seed)
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return l, err
	}
	if err := st.DB.QueryRow(ctx, `SELECT count(*) FROM lottery_entries WHERE showtime_id = $1`, showtimeID).Scan(&l.Entries); err != nil {
		return l, err
	}
	if accountID == "" {
		return l, nil
	}
	if err := st.DB.QueryRow(ctx, `SELECT
	    COALESCE((SELECT id FROM lottery_entries WHERE showtime_id = $1 AND account_id = $2), 0),
	    EXISTS (SELECT 1 FROM waitlist WHERE showtime_id = $1 AND account_id = $2),
	    EXISTS (SELECT 1 FROM holds WHERE showtime_id = $1 AND account_id = $2 AND status = 'paid')`, showtimeID, accountID).Scan(&l.MyEntry, &l.Waitlisted, &l.HasTicket); err != nil {
		return l, err
	}
	var hid string
	var exp time.Time
	err = st.DB.QueryRow(ctx, `SELECT id, expires_at FROM holds WHERE showtime_id = $1 AND account_id = $2 AND lottery AND (status = 'paid' OR (status = 'held' AND expires_at > now()))`, showtimeID, accountID).Scan(&hid, &exp)
	if err == nil {
		l.Won, l.WinHoldID, l.WinExpiresAt = true, hid, &exp
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return l, err
	}
	return l, nil
}

// EnterLottery adds one entry per verified account, while the premiere is sold out and before the draw.
func (st Store) EnterLottery(ctx context.Context, showtimeID, accountID string) (int64, error) {
	l, err := st.LotteryState(ctx, showtimeID, accountID)
	if err != nil {
		return 0, err
	}
	switch {
	case l.MyEntry != 0:
		return l.MyEntry, nil
	case l.HasTicket:
		return 0, ErrHasTicket
	case !l.SoldOut:
		return 0, ErrNotSoldOut
	case l.Drawn || time.Now().After(l.DrawAt):
		return 0, ErrDrawClosed
	}
	var verified bool
	if err := st.DB.QueryRow(ctx, `SELECT phone_verified_at IS NOT NULL OR id_verified_at IS NOT NULL FROM accounts WHERE id = $1`, accountID).Scan(&verified); err != nil {
		return 0, err
	}
	if !verified {
		return 0, ErrNotVerified
	}
	var id int64
	err = st.DB.QueryRow(ctx, `INSERT INTO lottery_entries (showtime_id, account_id) VALUES ($1, $2)
	  ON CONFLICT (showtime_id, account_id) DO UPDATE SET showtime_id = EXCLUDED.showtime_id RETURNING id`, showtimeID, accountID).Scan(&id)
	return id, err
}

// pick ranks entries by HMAC-SHA256(seed, entry id) and takes the lowest n. With the published
// seed anyone can repeat it.
func pick(seed []byte, ids []int64, n int) []int64 {
	type ranked struct {
		id int64
		r  []byte
	}
	rs := make([]ranked, len(ids))
	for i, id := range ids {
		m := hmac.New(sha256.New, seed)
		var b [8]byte
		binary.BigEndian.PutUint64(b[:], uint64(id))
		m.Write(b[:])
		rs[i] = ranked{id, m.Sum(nil)}
	}
	sort.Slice(rs, func(i, j int) bool { return string(rs[i].r) < string(rs[j].r) })
	if n > len(rs) {
		n = len(rs)
	}
	out := make([]int64, n)
	for i := range out {
		out[i] = rs[i].id
	}
	return out
}

// Draw runs the lottery once its time has come. Safe to call any number of times: only the
// first call after the draw time picks winners, and it returns them for the emails.
func (st Store) Draw(ctx context.Context, showtimeID string, now time.Time) ([]Winner, error) {
	var winners []Winner
	err := pgx.BeginFunc(ctx, st.DB, func(tx pgx.Tx) error {
		var seed []byte
		var drawn *time.Time
		var starts time.Time
		var capacity int
		err := tx.QueryRow(ctx, `SELECT d.seed, d.drawn_at, s.starts_at, s.capacity FROM lottery_draws d JOIN showtimes s ON s.id = d.showtime_id
		  WHERE d.showtime_id = $1 FOR UPDATE OF d`, showtimeID).Scan(&seed, &drawn, &starts, &capacity)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil // never sold out, so no lottery
		}
		if err != nil || drawn != nil || now.Before(starts.Add(-DrawBefore)) {
			return err
		}
		// One person, one entry: verified phones are unique already; this also skips anyone who
		// bought a seat after entering.
		rows, err := tx.Query(ctx, `SELECT DISTINCT ON (COALESCE(a.phone, a.id::text)) e.id
		  FROM lottery_entries e JOIN accounts a ON a.id = e.account_id
		  WHERE e.showtime_id = $1 AND NOT EXISTS (SELECT 1 FROM holds h WHERE h.showtime_id = e.showtime_id AND h.account_id = e.account_id AND h.status = 'paid')
		  ORDER BY COALESCE(a.phone, a.id::text), e.id`, showtimeID)
		if err != nil {
			return err
		}
		ids, err := pgx.CollectRows(rows, pgx.RowTo[int64])
		if err != nil {
			return err
		}
		seats := freeSeats(capacity)
		won := pick(seed, ids, seats)
		for _, id := range won {
			var w Winner
			if err := tx.QueryRow(ctx, `WITH e AS (UPDATE lottery_entries SET won = true WHERE id = $1 RETURNING account_id, showtime_id)
			  INSERT INTO holds (showtime_id, seats, viewer_ref, status, expires_at, account_id, lottery, net_cents)
			  SELECT e.showtime_id, 1, 'lottery', 'held', now() + $2::interval, e.account_id, true, 0 FROM e
			  RETURNING id, account_id`, id, ClaimFor.String()).Scan(&w.HoldID, &w.AccountID); err != nil {
				return err
			}
			if err := tx.QueryRow(ctx, `SELECT email, name FROM accounts WHERE id = $1`, w.AccountID).Scan(&w.Email, &w.Name); err != nil {
				return err
			}
			winners = append(winners, w)
		}
		_, err = tx.Exec(ctx, `UPDATE lottery_draws SET drawn_at = now(), seats = $2, entries = $3 WHERE showtime_id = $1`, showtimeID, seats, len(ids))
		return err
	})
	return winners, err
}

// ClaimWin turns a winning hold into a free paid seat.
func (st Store) ClaimWin(ctx context.Context, accountID, holdID string) error {
	tag, err := st.DB.Exec(ctx, `UPDATE holds SET status = 'paid', paypal_capture_id = 'LOTTERY-' || id
	  WHERE id = $1 AND account_id = $2 AND lottery AND status = 'held' AND expires_at > now()`, holdID, accountID)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNoWin
	}
	return err
}

// JoinWaitlist asks to hear when a paid seat comes back (a hold expires or a seat is cancelled).
func (st Store) JoinWaitlist(ctx context.Context, showtimeID, accountID string, on bool) error {
	var err error
	if on {
		_, err = st.DB.Exec(ctx, `INSERT INTO waitlist (showtime_id, account_id) SELECT $1, $2 WHERE EXISTS (SELECT 1 FROM showtimes WHERE id = $1) ON CONFLICT DO NOTHING`, showtimeID, accountID)
	} else {
		_, err = st.DB.Exec(ctx, `DELETE FROM waitlist WHERE showtime_id = $1 AND account_id = $2`, showtimeID, accountID)
	}
	return err
}

// WaitlistDue picks who to tell about seats that came back, oldest first, one per free seat,
// and marks them told. The caller sends the emails.
func (st Store) WaitlistDue(ctx context.Context, showtimeID string) ([]Winner, error) {
	rows, err := st.DB.Query(ctx, `WITH free AS (
	    SELECT GREATEST(s.capacity - `+taken+`, 0) AS n FROM showtimes s WHERE s.id = $1 AND s.starts_at + make_interval(mins => s.duration_min) > now()
	  ), due AS (
	    SELECT w.account_id FROM waitlist w WHERE w.showtime_id = $1 AND w.notified_at IS NULL
	    ORDER BY w.created_at LIMIT (SELECT n FROM free) FOR UPDATE SKIP LOCKED
	  ), told AS (
	    UPDATE waitlist w SET notified_at = now() FROM due WHERE w.showtime_id = $1 AND w.account_id = due.account_id RETURNING w.account_id
	  )
	  SELECT a.id, a.email, a.name FROM told JOIN accounts a ON a.id = told.account_id`, showtimeID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Winner, error) {
		var w Winner
		return w, r.Scan(&w.AccountID, &w.Email, &w.Name)
	})
}
