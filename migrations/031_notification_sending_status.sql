-- 031: Add 'sending' status for in-flight notifications
ALTER TABLE notification DROP CONSTRAINT notification_status_check;
ALTER TABLE notification ADD CONSTRAINT notification_status_check
  CHECK (status IN ('pending','sending','sent','failed','skipped'));
