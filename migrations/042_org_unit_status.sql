-- 042: Add status (active/archived) to org_unit (NDG-25)
-- 組織改編で組織が消えるケースに対応するため論理削除パターンを採用。
-- users.status と同じ active/inactive パターンに揃える。

ALTER TABLE org_unit
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'archived'));

ALTER TABLE org_unit
  ADD COLUMN archived_at TIMESTAMPTZ;

CREATE INDEX org_unit_tenant_status_idx ON org_unit (tenant_id, status);
