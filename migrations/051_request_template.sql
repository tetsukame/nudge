-- NDG-68: 依頼テンプレ
-- 部 / 課単位で共有する依頼テンプレ。月次提出等の繰り返し依頼を回しやすくするのが目的。
-- 所有: org_unit_id 単位。閲覧・編集は作成課のメンバー OR tenant_admin。
-- 版管理なし、論理削除 (archived_at)。

CREATE TABLE request_template (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID NOT NULL REFERENCES tenant(id),
  org_unit_id                 UUID NOT NULL REFERENCES org_unit(id),
  title                       TEXT NOT NULL,
  body                        TEXT,
  estimated_minutes           INT,
  default_due_offset_days     INT,
  default_targets_json        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by_user_id          UUID NOT NULL REFERENCES users(id),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at                 TIMESTAMPTZ
);

ALTER TABLE request_template ENABLE ROW LEVEL SECURITY;

CREATE POLICY request_template_tenant_isolation ON request_template
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE INDEX request_template_tenant_org_idx
  ON request_template (tenant_id, org_unit_id) WHERE archived_at IS NULL;
