-- NDG-72: 依頼取り消し (request cancel)
-- request.status の 'cancelled' 値は 009 で既に定義済みだが UI / domain がなかった。
-- 取り消し時の actor / 日時 / 理由を残す列を追加し、機能を有効化する。

ALTER TABLE request
  ADD COLUMN cancelled_at         TIMESTAMPTZ,
  ADD COLUMN cancelled_by_user_id UUID REFERENCES users(id),
  ADD COLUMN cancel_reason        TEXT;
