-- 033: Schedule next retry attempt for failed notifications
ALTER TABLE notification ADD COLUMN next_attempt_at TIMESTAMPTZ;

CREATE INDEX notification_retry_idx
  ON notification (status, next_attempt_at)
  WHERE status = 'failed' AND next_attempt_at IS NOT NULL;
