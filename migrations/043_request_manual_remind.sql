-- 043: Track the last manual remind timestamp per request (NDG-40)
-- 送信者が「リマインド」ボタンを押したときに re_notify を発火する API のための
-- 簡易レート制限。1 リクエストあたり 1 時間に 1 回の制限を行うために最終時刻を保持。

ALTER TABLE request
  ADD COLUMN last_manual_remind_at TIMESTAMPTZ;
