-- NDG-70: 予約送信
-- request.scheduled_at が NULL でない & status='draft' のものを worker が
-- scheduled_at <= now() で拾って status='active' に遷移させる。

ALTER TABLE request
  ADD COLUMN scheduled_at TIMESTAMPTZ;

-- Worker のホットパス用：拾うべき行だけを覗く部分インデックス
CREATE INDEX request_status_scheduled_idx
  ON request (scheduled_at)
  WHERE status = 'draft' AND scheduled_at IS NOT NULL;
