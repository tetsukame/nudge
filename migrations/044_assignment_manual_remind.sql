-- 044: Track the last manual remind timestamp per assignment (NDG-42)
-- 部下マトリクス画面で個別 (user × request) 単位の「リマインド」ボタンを
-- 連打しても 1 時間に 1 回しか飛ばないようにするためのレート制限カラム。
-- request 単位の `request.last_manual_remind_at`（mig 043）と同じ思想。

ALTER TABLE assignment
  ADD COLUMN last_manual_remind_at TIMESTAMPTZ;
