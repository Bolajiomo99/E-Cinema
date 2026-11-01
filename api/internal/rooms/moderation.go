package rooms

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

var (
	ErrNoMessage  = errors.New("that message is gone")
	ErrBadReason  = errors.New("invalid input: choose a reason")
	ErrReportSelf = errors.New("you cannot report or block yourself")
)

// Reasons people can report someone for, as listed in the report dialog.
var Reasons = map[string]bool{"harassment": true, "hate": true, "spoilers": true, "spam": true, "recording": true, "under13": true, "other": true}

// HideAfter is how many different people must report a message before it is hidden for everyone.
const HideAfter = 3

func (st Store) authorOf(ctx context.Context, showtimeID string, messageID int64) (string, error) {
	var author string
	err := st.DB.QueryRow(ctx, `SELECT account_id FROM room_messages WHERE id = $1 AND showtime_id = $2`, messageID, showtimeID).Scan(&author)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNoMessage
	}
	return author, err
}

// Report records a private report on a message. It returns whether the message is now hidden.
func (st Store) Report(ctx context.Context, showtimeID, reporterID string, messageID int64, reason string) (bool, error) {
	if !Reasons[reason] {
		return false, ErrBadReason
	}
	author, err := st.authorOf(ctx, showtimeID, messageID)
	if err != nil {
		return false, err
	}
	if author == reporterID {
		return false, ErrReportSelf
	}
	if _, err := st.DB.Exec(ctx, `INSERT INTO room_reports (reporter_id, reported_id, message_id, showtime_id, reason)
	  VALUES ($1, $2, $3, $4, $5) ON CONFLICT (reporter_id, message_id) DO UPDATE SET reason = EXCLUDED.reason`, reporterID, author, messageID, showtimeID, reason); err != nil {
		return false, err
	}
	var hidden bool
	err = st.DB.QueryRow(ctx, `UPDATE room_messages SET hidden = true WHERE id = $1 AND NOT hidden
	  AND (SELECT count(DISTINCT reporter_id) FROM room_reports WHERE message_id = $1) >= $2 RETURNING true`, messageID, HideAfter).Scan(&hidden)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return hidden, err
}

// Block hides everything the message's author says from the viewer, now and later.
// It returns the author and the ids of their recent messages at this premiere, so the
// viewer's screen can drop them straight away.
func (st Store) Block(ctx context.Context, showtimeID, viewerID string, messageID int64) (string, []int64, error) {
	author, err := st.authorOf(ctx, showtimeID, messageID)
	if err != nil {
		return "", nil, err
	}
	if author == viewerID {
		return "", nil, ErrReportSelf
	}
	if _, err := st.DB.Exec(ctx, `INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, viewerID, author); err != nil {
		return "", nil, err
	}
	rows, err := st.DB.Query(ctx, `SELECT id FROM room_messages WHERE showtime_id = $1 AND account_id = $2 ORDER BY id DESC LIMIT 500`, showtimeID, author)
	if err != nil {
		return "", nil, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[int64])
	return author, ids, err
}

// Blocked lists the accounts the viewer has blocked.
func (st Store) Blocked(ctx context.Context, viewerID string) (map[string]bool, error) {
	rows, err := st.DB.Query(ctx, `SELECT blocked_id FROM blocks WHERE blocker_id = $1`, viewerID)
	if err != nil {
		return nil, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	out := make(map[string]bool, len(ids))
	for _, id := range ids {
		out[id] = true
	}
	return out, err
}
