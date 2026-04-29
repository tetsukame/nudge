-- 035: Add estimated_minutes column to request
-- 依頼の想定所要時間（分）。デフォルト 5 分。
-- 既存依頼にも 5 が入る（要望どおり）。

ALTER TABLE request ADD COLUMN estimated_minutes INTEGER NOT NULL DEFAULT 5
  CHECK (estimated_minutes > 0);
