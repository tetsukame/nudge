-- 036: Add sender_org_unit_id to request, backfill is_primary on user_org_unit
-- 依頼元の組織を依頼に紐付ける。NULL = 個人依頼、値あり = 所属組織からの依頼。
-- 主所属 (is_primary) を NDG-10 で必須化したため、既存ユーザーの主所属未設定対応として
-- 「最初に登録された所属」を is_primary=true にする one-shot バックフィルを行う。

ALTER TABLE request
  ADD COLUMN sender_org_unit_id UUID REFERENCES org_unit(id);

CREATE INDEX request_sender_org_idx
  ON request (tenant_id, sender_org_unit_id);

-- Backfill: for each user without any is_primary=true row, set the earliest
-- (by assigned_at) user_org_unit as primary.
WITH primaryless_users AS (
  SELECT user_id
    FROM user_org_unit
   GROUP BY user_id
  HAVING bool_or(is_primary) = false
),
first_org AS (
  SELECT DISTINCT ON (uou.user_id) uou.user_id, uou.org_unit_id
    FROM user_org_unit uou
    JOIN primaryless_users p ON p.user_id = uou.user_id
   ORDER BY uou.user_id, uou.assigned_at ASC, uou.org_unit_id ASC
)
UPDATE user_org_unit uou
   SET is_primary = true
  FROM first_org fo
 WHERE uou.user_id = fo.user_id
   AND uou.org_unit_id = fo.org_unit_id;
