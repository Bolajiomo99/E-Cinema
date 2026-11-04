package notify

import "context"

// Captured notes a successful payment for whatever the PayPal order bought: seats, a kept
// film or a gift. Each order is noted once.
func (s Store) Captured(ctx context.Context, orderID string) error {
	if s.DB == nil {
		return nil
	}
	_, err := s.DB.Exec(ctx, `INSERT INTO notifications (account_id, kind, title, body, link, dedupe)
	  SELECT h.account_id, 'payment', 'Payment received for ' || st.film,
	    h.seats || CASE WHEN h.seats = 1 THEN ' seat' ELSE ' seats' END || ' · ' || to_char(st.starts_at AT TIME ZONE 'UTC', 'Dy DD Mon, HH24:MI') || ' UTC',
	    '/tickets', 'paid:' || $1
	  FROM holds h JOIN showtimes st ON st.id = h.showtime_id
	  WHERE h.paypal_order_id = $1 AND h.account_id IS NOT NULL AND h.status = 'paid'
	    AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.hold_id = h.id)
	  UNION ALL
	  SELECT k.account_id, 'payment', st.film || ' is yours to keep', 'It stays in your Library and you can download it.', '/library', 'paid:' || $1
	  FROM library_keeps k JOIN showtimes st ON st.id = k.showtime_id WHERE k.paypal_order_id = $1 AND k.status = 'paid'
	  UNION ALL
	  SELECT g.giver_id, 'payment', 'Your gift for ' || g.recipient_name || ' is paid',
	    CASE WHEN g.deliver_at > now() THEN 'We will send it on ' || to_char(g.deliver_at AT TIME ZONE 'UTC', 'Dy DD Mon') || '.' ELSE 'We are sending it now.' END,
	    '/gift', 'paid:' || $1
	  FROM gifts g WHERE g.paypal_order_id = $1 AND g.status IN ('paid', 'redeemed')
	  ON CONFLICT (account_id, dedupe) WHERE dedupe IS NOT NULL DO NOTHING`, orderID)
	if err != nil {
		return err
	}
	return s.ticketMail(ctx, orderID)
}

// Refunded notes a refund on a seat purchase.
func (s Store) Refunded(ctx context.Context, captureID string) error {
	if s.DB == nil {
		return nil
	}
	_, err := s.DB.Exec(ctx, `INSERT INTO notifications (account_id, kind, title, body, link, dedupe)
	  SELECT h.account_id, 'refund', 'Refund sent for ' || st.film, 'It can take a few days to reach your account.', '/tickets', 'refund:' || $1
	  FROM holds h JOIN showtimes st ON st.id = h.showtime_id
	  WHERE h.paypal_capture_id = $1 AND h.account_id IS NOT NULL
	  ON CONFLICT (account_id, dedupe) WHERE dedupe IS NOT NULL DO NOTHING`, captureID)
	if err != nil {
		return err
	}
	return s.refundMail(ctx, captureID)
}

// GiftRedeemed tells the giver their gift was opened.
func (s Store) GiftRedeemed(ctx context.Context, code string) error {
	if s.DB == nil {
		return nil
	}
	_, err := s.DB.Exec(ctx, `INSERT INTO notifications (account_id, kind, title, body, link, dedupe)
	  SELECT g.giver_id, 'gift', g.recipient_name || ' opened your gift',
	    CASE g.kind WHEN 'seat' THEN 'Their seat for ' || coalesce(st.film, 'the premiere') || ' is ready.' WHEN 'credit' THEN 'The credit is in their wallet.' ELSE 'Their plan is on.' END,
	    '/gift', 'gift:' || g.id
	  FROM gifts g LEFT JOIN showtimes st ON st.id = g.showtime_id
	  WHERE g.code = $1 AND g.status = 'redeemed'
	  ON CONFLICT (account_id, dedupe) WHERE dedupe IS NOT NULL DO NOTHING`, code)
	return err
}
