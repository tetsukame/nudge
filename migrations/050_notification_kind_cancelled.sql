-- NDG-78 (NDG-72 follow-up): notification.kind CHECK に 'cancelled' を追加
-- NDG-72 のマイグレーション 049 では request 列のみ追加し、notification.kind
-- への 'cancelled' 値の許可を忘れていた。dev 検証で発覚。

ALTER TABLE notification DROP CONSTRAINT notification_kind_check;
ALTER TABLE notification ADD CONSTRAINT notification_kind_check
  CHECK (kind IN (
    'created','reminder_before','due_today','re_notify','completed','cancelled'
  ));
