package notify

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

// Emails (Figma page 08 Emails, 106:5) go through an outbox: producers queue a kind, an address
// and the facts the design needs; the web app renders and sends them with Resend and reports
// back. The dedupe key keeps each email to one send, even when an event repeats.

// MaxMailTries is how many times one email is tried before it is given up.
const MaxMailTries = 5

// Mail is one queued email.
type Mail struct {
	Kind, To, Name, Dedupe string
	Data                   map[string]any
	SendAfter              time.Time
}

// Outgoing is a queued email handed to the sender, with the member's country (for currency,
// VAT and time zone) when the address belongs to an account.
type Outgoing struct {
	ID      int64           `json:"id"`
	Kind    string          `json:"kind"`
	To      string          `json:"to"`
	Name    string          `json:"name"`
	Country string          `json:"country"`
	Data    json.RawMessage `json:"data"`
}

// Queue stores an email to send. A repeat with the same dedupe key is ignored.
func (s Store) Queue(ctx context.Context, m Mail) error {
	if s.DB == nil {
		return nil
	}
	if m.Kind == "" || m.To == "" {
		return errors.New("mail needs a kind and an address")
	}
	data, _ := json.Marshal(m.Data)
	if m.Data == nil {
		data = []byte("{}")
	}
	var dedupe *string
	if m.Dedupe != "" {
		dedupe = &m.Dedupe
	}
	var after *time.Time
	if !m.SendAfter.IsZero() {
		after = &m.SendAfter
	}
	_, err := s.DB.Exec(ctx, `INSERT INTO mail_outbox (kind, to_email, to_name, data, dedupe, send_after)
	  VALUES ($1, lower($2), $3, $4::jsonb, $5, coalesce($6, now())) ON CONFLICT (dedupe) DO NOTHING`,
		m.Kind, m.To, m.Name, string(data), dedupe, after)
	return err
}

// QueueAccount queues an email to an account's own address.
func (s Store) QueueAccount(ctx context.Context, accountID string, m Mail) error {
	if s.DB == nil {
		return nil
	}
	if err := s.DB.QueryRow(ctx, `SELECT email, name FROM accounts WHERE id = $1 AND delete_after IS NULL`, accountID).Scan(&m.To, &m.Name); err != nil {
		return nil
	}
	return s.Queue(ctx, m)
}

// Cancel drops a queued email that has not gone out yet, for example a reminder that no
// longer applies.
func (s Store) Cancel(ctx context.Context, dedupe string) error {
	if s.DB == nil {
		return nil
	}
	_, err := s.DB.Exec(ctx, `UPDATE mail_outbox SET failed_at = now(), last_error = 'cancelled'
	  WHERE dedupe = $1 AND sent_at IS NULL AND failed_at IS NULL`, dedupe)
	return err
}

// CancelKind drops every unsent email of one kind to one address.
func (s Store) CancelKind(ctx context.Context, kind, to string) error {
	if s.DB == nil {
		return nil
	}
	_, err := s.DB.Exec(ctx, `UPDATE mail_outbox SET failed_at = now(), last_error = 'cancelled'
	  WHERE kind = $1 AND to_email = lower($2) AND sent_at IS NULL AND failed_at IS NULL`, kind, to)
	return err
}

// DueMail claims up to limit emails that are ready. A claim lasts ten minutes, so a sender
// that dies mid-batch does not lose them.
func (s Store) DueMail(ctx context.Context, limit int) ([]Outgoing, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	// Accounts the deploy smoke test signs up never get email.
	if _, err := s.DB.Exec(ctx, `UPDATE mail_outbox SET sent_at = now(), last_error = 'test account'
	  WHERE sent_at IS NULL AND failed_at IS NULL AND to_email LIKE 'smoke+%@e-cinema.net'`); err != nil {
		return nil, err
	}
	rows, err := s.DB.Query(ctx, `WITH due AS (
	    SELECT id FROM mail_outbox
	    WHERE sent_at IS NULL AND failed_at IS NULL AND send_after <= now()
	      AND (claimed_at IS NULL OR claimed_at < now() - interval '10 minutes')
	    ORDER BY send_after, id LIMIT $1 FOR UPDATE SKIP LOCKED)
	  UPDATE mail_outbox m SET claimed_at = now(), tries = m.tries + 1 FROM due WHERE m.id = due.id
	  RETURNING m.id, m.kind, m.to_email, m.to_name,
	    coalesce((SELECT a.country FROM accounts a WHERE a.email = m.to_email), ''), m.data`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Outgoing{}
	for rows.Next() {
		var o Outgoing
		if err := rows.Scan(&o.ID, &o.Kind, &o.To, &o.Name, &o.Country, &o.Data); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// MailDone records the outcome of one send. A failure is retried later until MaxMailTries.
func (s Store) MailDone(ctx context.Context, id int64, failure string) error {
	if failure == "" {
		_, err := s.DB.Exec(ctx, `UPDATE mail_outbox SET sent_at = now(), last_error = NULL WHERE id = $1`, id)
		return err
	}
	_, err := s.DB.Exec(ctx, `UPDATE mail_outbox SET claimed_at = NULL, last_error = left($2, 300),
	    failed_at = CASE WHEN tries >= $3 THEN now() END,
	    send_after = now() + make_interval(mins => 5 * tries)
	  WHERE id = $1 AND sent_at IS NULL`, id, failure, MaxMailTries)
	return err
}

// ticketMail queues the confirmation for every seat the order paid for: a pre-order when the
// premiere is more than 3 days away, a late-entry seat when bought more than 15 minutes after
// the start, otherwise a ticket.
func (s Store) ticketMail(ctx context.Context, orderID string) error {
	_, err := s.DB.Exec(ctx, `INSERT INTO mail_outbox (kind, to_email, to_name, data, dedupe)
	  SELECT CASE WHEN st.starts_at - now() > interval '3 days' THEN 'preorder'
	              WHEN now() > st.starts_at + interval '15 minutes' THEN 'late_ticket' ELSE 'ticket' END,
	    a.email, a.name,
	    jsonb_build_object('film', st.film, 'studio', st.studio, 'showtimeId', st.id, 'startsAt', st.starts_at,
	      'seats', h.seats, 'quality', h.quality, 'netMinor', coalesce(h.net_cents, h.seats * st.price_cents),
	      'currency', st.currency, 'ticket', 'EC-T-' || upper(left(replace(h.id::text, '-', ''), 8)),
	      'stage', CASE WHEN st.starts_at - now() > interval '14 days' THEN 1 ELSE 2 END,
	      'minutesIn', greatest(0, extract(epoch FROM now() - st.starts_at)::int / 60)),
	    'ticket:' || h.id
	  FROM holds h JOIN showtimes st ON st.id = h.showtime_id JOIN accounts a ON a.id = h.account_id
	  WHERE h.paypal_order_id = $1 AND h.status = 'paid' AND a.delete_after IS NULL
	    AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.hold_id = h.id)
	  ON CONFLICT (dedupe) DO NOTHING`, orderID)
	return err
}

// refundMail queues the "refund on its way" email for each seat a capture refunded: email 30
// (Figma 127:149) when the studio withdrew the premiere, otherwise email 13 (106:384).
func (s Store) refundMail(ctx context.Context, captureID string) error {
	return s.refundMailWhere(ctx, `h.paypal_capture_id = $1`, captureID)
}

// RefundedHold queues the refund email for one seat (credit refunds have no capture).
func (s Store) RefundedHold(ctx context.Context, holdID string) error {
	if s.DB == nil {
		return nil
	}
	return s.refundMailWhere(ctx, `h.id::text = $1`, holdID)
}

func (s Store) refundMailWhere(ctx context.Context, where, arg string) error {
	_, err := s.DB.Exec(ctx, `INSERT INTO mail_outbox (kind, to_email, to_name, data, dedupe)
	  SELECT CASE WHEN st.withdrawn_at IS NOT NULL THEN 'premiere_cancelled' ELSE 'refund' END, a.email, a.name,
	    jsonb_build_object('what', st.film || ' · ' || h.seats || CASE WHEN h.seats = 1 THEN ' seat' ELSE ' seats' END, 'film', st.film,
	      'netMinor', coalesce(h.net_cents, h.seats * st.price_cents), 'currency', st.currency, 'credit', coalesce(h.paypal_refund_id, '') LIKE 'CREDIT-%',
	      'ref', 'EC-T-' || upper(left(replace(h.id::text, '-', ''), 8)), 'link', '/tickets'),
	    'refund:' || h.id
	  FROM holds h JOIN showtimes st ON st.id = h.showtime_id JOIN accounts a ON a.id = h.account_id
	  WHERE `+where+` AND h.status = 'refunded' AND coalesce(h.paypal_refund_id, '') NOT LIKE 'NONE-%'
	  ON CONFLICT (dedupe) DO NOTHING`, arg)
	return err
}

// PayoutMail queues email 20 (Figma 106:599) to the studio's owner once a screening's 70%
// share has been sent by PayPal.
func (s Store) PayoutMail(ctx context.Context, showtimeID string) error {
	if s.DB == nil {
		return nil
	}
	_, err := s.DB.Exec(ctx, `INSERT INTO mail_outbox (kind, to_email, to_name, data, dedupe)
	  SELECT 'studio_payout', m.email, p.studio,
	    jsonb_build_object('studio', p.studio, 'film', st.film, 'startsAt', st.starts_at, 'seats', p.paid_seats,
	      'grossMinor', p.gross_cents, 'shareMinor', p.studio_cents, 'currency', p.currency, 'sharePct', (s2.share_bps / 100),
	      'payTo', regexp_replace(s2.payout_email, '^(.).*(@.*)$', '\1•••\2')),
	    'payout:' || p.showtime_id
	  FROM studio_payouts p JOIN showtimes st ON st.id = p.showtime_id JOIN studios s2 ON s2.name = p.studio
	  JOIN LATERAL (SELECT email FROM studio_members WHERE studio = p.studio AND role = 'owner' ORDER BY added_at LIMIT 1) m ON true
	  WHERE p.showtime_id = $1 AND p.status = 'sent' AND p.studio_cents > 0
	  ON CONFLICT (dedupe) DO NOTHING`, showtimeID)
	return err
}

// ScheduleMail queues the emails whose time has come: premiere reminders, "started, not joined
// yet", the pre-order week-to-go note, plan renewal notices, gifts nobody claimed and the weekly
// round-up. It runs every minute and returns how many it queued.
func (s Store) ScheduleMail(ctx context.Context, now time.Time) (int64, error) {
	if s.DB == nil {
		return 0, nil
	}
	var total int64
	for _, q := range scheduled {
		tag, err := s.DB.Exec(ctx, q, now)
		if err != nil {
			return total, err
		}
		total += tag.RowsAffected()
	}
	return total, nil
}

// Each query takes the current time as $1 and inserts into mail_outbox, deduped.
var scheduled = []string{
	// 09: one hour before a booked premiere.
	`INSERT INTO mail_outbox (kind, to_email, to_name, data, dedupe)
	  SELECT DISTINCT ON (a.id, st.id) 'reminder', a.email, a.name,
	    jsonb_build_object('film', st.film, 'showtimeId', st.id, 'startsAt', st.starts_at,
	      'lobby', (SELECT count(DISTINCT h2.account_id) FROM holds h2 WHERE h2.showtime_id = st.id AND h2.status = 'paid')),
	    'remind:' || a.id || ':' || st.id
	  FROM holds h JOIN showtimes st ON st.id = h.showtime_id JOIN accounts a ON a.id = h.account_id
	  WHERE h.status = 'paid' AND a.delete_after IS NULL
	    AND st.starts_at > $1::timestamptz AND st.starts_at <= $1::timestamptz + interval '1 hour'
	  ON CONFLICT (dedupe) DO NOTHING`,
	// 27: five minutes after the start, for ticket holders who have not pressed play.
	`INSERT INTO mail_outbox (kind, to_email, to_name, data, dedupe)
	  SELECT DISTINCT ON (a.id, st.id) 'not_joined', a.email, a.name,
	    jsonb_build_object('film', st.film, 'showtimeId', st.id, 'startsAt', st.starts_at,
	      'ticket', 'EC-T-' || upper(left(replace(h.id::text, '-', ''), 8))),
	    'notjoined:' || a.id || ':' || st.id
	  FROM holds h JOIN showtimes st ON st.id = h.showtime_id JOIN accounts a ON a.id = h.account_id
	  WHERE h.status = 'paid' AND a.delete_after IS NULL
	    AND st.starts_at <= $1::timestamptz - interval '5 minutes' AND st.starts_at > $1::timestamptz - interval '30 minutes'
	    AND NOT EXISTS (SELECT 1 FROM watch_beats w WHERE w.account_id = a.id AND w.showtime_id = st.id)
	  ON CONFLICT (dedupe) DO NOTHING`,
	// 32: seven days before a premiere the member pre-ordered.
	`INSERT INTO mail_outbox (kind, to_email, to_name, data, dedupe)
	  SELECT DISTINCT ON (a.id, st.id) 'preorder_week', a.email, a.name,
	    jsonb_build_object('film', st.film, 'showtimeId', st.id, 'startsAt', st.starts_at,
	      'ticket', 'EC-T-' || upper(left(replace(h.id::text, '-', ''), 8))),
	    'preweek:' || a.id || ':' || st.id
	  FROM holds h JOIN showtimes st ON st.id = h.showtime_id JOIN accounts a ON a.id = h.account_id
	  WHERE h.status = 'paid' AND a.delete_after IS NULL AND h.paid_at < st.starts_at - interval '8 days'
	    AND st.starts_at > $1::timestamptz + interval '6 days' AND st.starts_at <= $1::timestamptz + interval '7 days'
	  ON CONFLICT (dedupe) DO NOTHING`,
	// 48: three days before a paid plan renews.
	`INSERT INTO mail_outbox (kind, to_email, to_name, data, dedupe)
	  SELECT 'plan_renews', a.email, a.name,
	    jsonb_build_object('plan', a.plan, 'renewsAt', a.plan_renews_at),
	    'renews:' || a.id || ':' || to_char(a.plan_renews_at, 'YYYY-MM-DD')
	  FROM accounts a
	  WHERE a.plan IN ('student', 'pro', 'vip') AND a.plan_status = 'active' AND a.delete_after IS NULL
	    AND a.paypal_subscription_id IS NOT NULL
	    AND a.plan_renews_at > $1::timestamptz + interval '2 days' AND a.plan_renews_at <= $1::timestamptz + interval '3 days'
	  ON CONFLICT (dedupe) DO NOTHING`,
	// 46: a seat gift still not opened 3 days after it was delivered, while the premiere is ahead.
	`INSERT INTO mail_outbox (kind, to_email, to_name, data, dedupe)
	  SELECT 'gift_waiting', a.email, a.name,
	    jsonb_build_object('recipient', g.recipient_name, 'kind', g.kind, 'film', st.film, 'startsAt', st.starts_at,
	      'gift', 'GFT-' || upper(left(g.code, 6)), 'days', extract(day FROM $1::timestamptz - g.delivered_at)::int),
	    'giftwait:' || g.id
	  FROM gifts g JOIN accounts a ON a.id = g.giver_id LEFT JOIN showtimes st ON st.id = g.showtime_id
	  WHERE g.status = 'paid' AND g.delivered_at IS NOT NULL AND g.delivered_at <= $1::timestamptz - interval '3 days'
	    AND (st.id IS NULL OR st.starts_at > $1::timestamptz) AND a.delete_after IS NULL
	  ON CONFLICT (dedupe) DO NOTHING`,
	// 42: 30 days before a merch licence ends.
	`INSERT INTO mail_outbox (kind, to_email, to_name, data, dedupe)
	  SELECT 'licence_renewal', a.email, b.name,
	    jsonb_build_object('company', b.name, 'licence', b.licence, 'plan', b.plan, 'country', b.country, 'validUntil', b.valid_until),
	    'licrenew:' || b.licence || ':' || b.valid_until
	  FROM brand_licensees b JOIN accounts a ON a.id = b.account_id
	  WHERE b.status = 'active' AND b.valid_until IS NOT NULL
	    AND b.valid_until <= ($1::timestamptz + interval '30 days')::date AND b.valid_until > ($1::timestamptz + interval '29 days')::date
	  ON CONFLICT (dedupe) DO NOTHING`,
	// 21: Fridays from 09:00 UTC, the week's premieres for members who keep news email on.
	`INSERT INTO mail_outbox (kind, to_email, to_name, data, dedupe)
	  SELECT 'weekly', a.email, a.name, jsonb_build_object('picks', p.picks), 'weekly:' || to_char($1::timestamptz, 'IYYY-IW') || ':' || a.id
	  FROM (SELECT jsonb_agg(jsonb_build_object('film', x.film, 'showtimeId', x.id, 'startsAt', x.starts_at, 'studio', x.studio) ORDER BY x.starts_at) AS picks
	        FROM (SELECT * FROM (SELECT DISTINCT ON (s.film) s.* FROM showtimes s
	                WHERE NOT s.adult AND s.starts_at > $1::timestamptz AND s.starts_at <= $1::timestamptz + interval '7 days'
	                ORDER BY s.film, s.starts_at) d ORDER BY d.starts_at LIMIT 3) x) p
	  CROSS JOIN accounts a
	  WHERE extract(isodow FROM $1::timestamptz AT TIME ZONE 'UTC') = 5 AND extract(hour FROM $1::timestamptz AT TIME ZONE 'UTC') >= 9
	    AND p.picks IS NOT NULL AND a.delete_after IS NULL AND a.created_at < $1::timestamptz - interval '1 day'
	    AND coalesce(a.prefs->>'n.features.email', 'true') <> 'false' AND a.email NOT LIKE 'smoke+%@e-cinema.net'
	  ON CONFLICT (dedupe) DO NOTHING`,
}
