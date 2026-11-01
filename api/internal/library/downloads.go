package library

import (
	"context"
	"errors"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5"
)

// LicenseLife is how long a downloaded film plays offline before the device must check in.
const LicenseLife = 30 * 24 * time.Hour

// Limits on downloads: films per account, devices per account.
const (
	MaxDownloads       = 25
	MaxDownloadDevices = 2
)

var (
	ErrNotOwned     = errors.New("keep the film first to download it")
	ErrTooManyFiles = errors.New("you have the most downloads allowed; delete one first")
	ErrTooManyDevs  = errors.New("downloads are on two devices already; delete them on one first")
	ErrNoLicense    = errors.New("this download has expired or was deleted")
)

var deviceRe = regexp.MustCompile(`^[a-z0-9]{16,40}$`)

type License struct {
	ID         string    `json:"id"`
	ShowtimeID string    `json:"showtimeId"`
	Film       string    `json:"film"`
	Device     string    `json:"device"`
	Quality    string    `json:"quality"`
	SizeBytes  int64     `json:"sizeBytes"`
	Audio      []string  `json:"audio"`
	CreatedAt  time.Time `json:"createdAt"`
	ExpiresAt  time.Time `json:"expiresAt"`
}

func (s Store) ownsFilm(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, accountID, showtimeID string) (bool, error) {
	var ok bool
	err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM library_keeps WHERE account_id = $1 AND showtime_id = $2 AND status = 'paid')`, accountID, showtimeID).Scan(&ok)
	return ok, err
}

// License issues (or renews) the licence for a kept film on one device.
func (s Store) License(ctx context.Context, accountID, showtimeID, device, quality string, size int64, audio []string, now time.Time) (License, error) {
	if !deviceRe.MatchString(device) || (quality != "sd" && quality != "hd") || size < 0 || len(audio) > 8 {
		return License{}, ErrBadInput
	}
	var l License
	err := pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		// One account's downloads are decided one at a time, so the limits hold under races.
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('dl:' || $1::text))`, accountID); err != nil {
			return err
		}
		owned, err := s.ownsFilm(ctx, tx, accountID, showtimeID)
		if err != nil {
			return err
		}
		if !owned {
			return ErrNotOwned
		}
		var files, devices int
		var mine bool
		if err := tx.QueryRow(ctx, `SELECT count(*), count(DISTINCT device),
		    coalesce(bool_or(showtime_id = $2 AND device = $3), false)
		  FROM download_licenses WHERE account_id = $1 AND revoked_at IS NULL AND expires_at > $4`, accountID, showtimeID, device, now).Scan(&files, &devices, &mine); err != nil {
			return err
		}
		if !mine {
			if files >= MaxDownloads {
				return ErrTooManyFiles
			}
			var devKnown bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM download_licenses WHERE account_id = $1 AND device = $2 AND revoked_at IS NULL AND expires_at > $3)`, accountID, device, now).Scan(&devKnown); err != nil {
				return err
			}
			if !devKnown && devices >= MaxDownloadDevices {
				return ErrTooManyDevs
			}
		}
		// Expired licences on this device for this film are cleared so the unique index allows a new one.
		if _, err := tx.Exec(ctx, `UPDATE download_licenses SET revoked_at = $4 WHERE account_id = $1 AND showtime_id = $2 AND device = $3 AND revoked_at IS NULL AND expires_at <= $4`, accountID, showtimeID, device, now); err != nil {
			return err
		}
		if audio == nil {
			audio = []string{}
		}
		return tx.QueryRow(ctx, `INSERT INTO download_licenses (account_id, showtime_id, device, quality, size_bytes, audio, expires_at)
		  VALUES ($1, $2, $3, $4, $5, $6, $7)
		  ON CONFLICT (account_id, showtime_id, device) WHERE revoked_at IS NULL
		  DO UPDATE SET expires_at = EXCLUDED.expires_at, quality = EXCLUDED.quality,
		    size_bytes = CASE WHEN EXCLUDED.size_bytes > 0 THEN EXCLUDED.size_bytes ELSE download_licenses.size_bytes END,
		    audio = CASE WHEN cardinality(EXCLUDED.audio) > 0 THEN EXCLUDED.audio ELSE download_licenses.audio END
		  RETURNING id, showtime_id, (SELECT film FROM showtimes WHERE id = $2), device, quality, size_bytes, audio, created_at, expires_at`,
			accountID, showtimeID, device, quality, size, audio, now.Add(LicenseLife)).
			Scan(&l.ID, &l.ShowtimeID, &l.Film, &l.Device, &l.Quality, &l.SizeBytes, &l.Audio, &l.CreatedAt, &l.ExpiresAt)
	})
	return l, err
}

// Licenses lists the account's live downloads on every device.
func (s Store) Licenses(ctx context.Context, accountID string, now time.Time) ([]License, error) {
	rows, err := s.DB.Query(ctx, `SELECT d.id, d.showtime_id, st.film, d.device, d.quality, d.size_bytes, d.audio, d.created_at, d.expires_at
	  FROM download_licenses d JOIN showtimes st ON st.id = d.showtime_id
	  WHERE d.account_id = $1 AND d.revoked_at IS NULL AND d.expires_at > $2
	    AND EXISTS (SELECT 1 FROM library_keeps k WHERE k.account_id = d.account_id AND k.showtime_id = d.showtime_id AND k.status = 'paid')
	  ORDER BY d.created_at DESC`, accountID, now)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (License, error) {
		var l License
		return l, r.Scan(&l.ID, &l.ShowtimeID, &l.Film, &l.Device, &l.Quality, &l.SizeBytes, &l.Audio, &l.CreatedAt, &l.ExpiresAt)
	})
}

// CheckLicense confirms a device may still play a download (and that the film is still owned).
func (s Store) CheckLicense(ctx context.Context, accountID, showtimeID, device string, now time.Time) (License, error) {
	all, err := s.Licenses(ctx, accountID, now)
	if err != nil {
		return License{}, err
	}
	for _, l := range all {
		if l.ShowtimeID == showtimeID && l.Device == device {
			return l, nil
		}
	}
	return License{}, ErrNoLicense
}

// Revoke deletes a download licence (the device deletes the file too).
func (s Store) Revoke(ctx context.Context, accountID, showtimeID, device string, now time.Time) error {
	_, err := s.DB.Exec(ctx, `UPDATE download_licenses SET revoked_at = $4 WHERE account_id = $1 AND showtime_id = $2 AND device = $3 AND revoked_at IS NULL`, accountID, showtimeID, device, now)
	return err
}
