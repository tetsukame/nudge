-- 037: Drop request.type column entirely (NDG-7)
-- アンケート種別は v0.10 で廃止し、依頼は task のみとする。
-- 既存の survey データは未使用のため全削除。type カラムごと撤去して
-- スキーマをシンプルに保つ。将来「タスクの種類」を再導入する場合は
-- 改めて設計する前提（履歴互換性は不要）。

DELETE FROM request WHERE type = 'survey';

ALTER TABLE request DROP COLUMN type;
