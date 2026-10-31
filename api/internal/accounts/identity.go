package accounts

import "context"

// RecordIdentity stores a face/ID check outcome. Approval marks both face and ID as verified,
// because the Sumsub level includes a liveness selfie and a document.
func (s Store) RecordIdentity(ctx context.Context, accountID, status string) (Account, error) {
	return scanAccount(s.DB.QueryRow(ctx, `
		UPDATE accounts SET
			identity_status = $2,
			identity_checked_at = now(),
			face_verified_at = CASE WHEN $2 = 'approved' THEN coalesce(face_verified_at, now()) ELSE face_verified_at END,
			id_verified_at = CASE WHEN $2 = 'approved' THEN coalesce(id_verified_at, now()) ELSE id_verified_at END
		WHERE id = $1 RETURNING `+accountCols, accountID, status))
}
