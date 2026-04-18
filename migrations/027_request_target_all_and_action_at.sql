-- 027: Allow 'all' target type (全社依頼) and add assignment.action_at for sort

-- 1. Drop old PK + CHECK on request_target so we can allow target_id = NULL for 'all'
ALTER TABLE request_target DROP CONSTRAINT request_target_pkey;
ALTER TABLE request_target DROP CONSTRAINT request_target_target_type_check;

-- Add id surrogate PK so partial uniqueness works cleanly
ALTER TABLE request_target ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE request_target ADD PRIMARY KEY (id);

-- Allow NULL target_id for type='all'
ALTER TABLE request_target ALTER COLUMN target_id DROP NOT NULL;

-- New CHECK with 'all'
ALTER TABLE request_target ADD CONSTRAINT request_target_target_type_check
  CHECK (target_type IN ('org_unit', 'group', 'user', 'all'));

-- Shape constraint: 'all' must have NULL target_id; everything else must have NOT NULL
ALTER TABLE request_target ADD CONSTRAINT request_target_target_id_shape
  CHECK (
    (target_type = 'all' AND target_id IS NULL)
    OR (target_type <> 'all' AND target_id IS NOT NULL)
  );

-- Uniqueness: at most one row per (request_id, target_type, target_id),
-- and at most one 'all' row per request.
CREATE UNIQUE INDEX request_target_unique_nonall_idx
  ON request_target (request_id, target_type, target_id)
  WHERE target_type <> 'all';
CREATE UNIQUE INDEX request_target_unique_all_idx
  ON request_target (request_id)
  WHERE target_type = 'all';

-- 2. assignment.action_at — last user action timestamp for sorting
ALTER TABLE assignment ADD COLUMN action_at TIMESTAMPTZ;
CREATE INDEX assignment_tenant_user_action_at_idx
  ON assignment (tenant_id, user_id, action_at DESC NULLS LAST);
