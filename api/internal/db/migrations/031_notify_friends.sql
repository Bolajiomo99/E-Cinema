-- Friend requests and accepted requests show in Notifications under Social.
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('premiere', 'party', 'lottery', 'reply', 'language', 'signin', 'payment', 'refund', 'share', 'gift', 'friend'));
