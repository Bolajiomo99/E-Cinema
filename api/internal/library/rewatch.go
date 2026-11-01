package library

import (
	"context"
	"crypto/rand"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// ErrBadStart is returned for a party start that is in the past or too far ahead.
var ErrBadStart = errors.New("pick a start time within the next 7 days")

// Rewatch is a rewatch party: one film, one shared clock.
type Rewatch struct {
	Code       string    `json:"code"`
	ShowtimeID string    `json:"showtimeId"`
	Film       string    `json:"film"`
	Host       string    `json:"host"`
	Mine       bool      `json:"mine"`
	StartsAt   time.Time `json:"startsAt"`
}

const codeChars = "abcdefghijkmnpqrstuvwxyz23456789"

func newCode() string {
	b := make([]byte, 10)
	rand.Read(b)
	for i := range b {
		b[i] = codeChars[int(b[i])%len(codeChars)]
	}
	return string(b)
}

// StartRewatch makes a party for a film the host can play, starting at the given time.
func (s Store) StartRewatch(ctx context.Context, accountID, showtimeID string, startsAt, now time.Time) (Rewatch, error) {
	if startsAt.Before(now.Add(-time.Minute)) || startsAt.After(now.Add(7*24*time.Hour)) {
		return Rewatch{}, ErrBadStart
	}
	it, err := s.Access(ctx, accountID, showtimeID, now)
	if err != nil {
		return Rewatch{}, err
	}
	r := Rewatch{Code: newCode(), ShowtimeID: showtimeID, Film: it.Film, Mine: true, StartsAt: startsAt.UTC().Truncate(time.Second)}
	err = s.DB.QueryRow(ctx, `INSERT INTO rewatch_parties (code, showtime_id, host_id, starts_at) VALUES ($1, $2, $3, $4)
	  RETURNING (SELECT name FROM accounts WHERE id = $3)`, r.Code, showtimeID, accountID, r.StartsAt).Scan(&r.Host)
	return r, err
}

// GetRewatch returns a party, but only to someone who can play its film.
func (s Store) GetRewatch(ctx context.Context, accountID, code string, now time.Time) (Rewatch, error) {
	var r Rewatch
	var host string
	err := s.DB.QueryRow(ctx, `SELECT p.code, p.showtime_id, st.film, a.name, p.host_id::text, p.starts_at
	  FROM rewatch_parties p JOIN showtimes st ON st.id = p.showtime_id JOIN accounts a ON a.id = p.host_id
	  WHERE p.code = $1`, code).Scan(&r.Code, &r.ShowtimeID, &r.Film, &r.Host, &host, &r.StartsAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return r, ErrNotFound
	}
	if err != nil {
		return r, err
	}
	r.Mine = host == accountID
	if _, err := s.Access(ctx, accountID, r.ShowtimeID, now); err != nil {
		return r, err
	}
	return r, nil
}
