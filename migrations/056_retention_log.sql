-- NDG-89 (NDG-87 retention 設計 2/3): retention worker の実行履歴。
-- どの tenant の どのテーブルで いつ何件 archived_at をセット / DELETE したかを記録。
-- /root/retention 監視ダッシュボード (Notion 設計通り) の元データになる。

CREATE TABLE retention_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenant(id),
  table_name    TEXT NOT NULL
    CHECK (table_name IN ('notification','audit_log','assignment_status_history','sync_log')),
  action        TEXT NOT NULL CHECK (action IN ('soft','hard')),
  rows_affected INT NOT NULL DEFAULT 0,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  error_message TEXT
);

CREATE INDEX retention_log_tenant_idx
  ON retention_log (tenant_id, started_at DESC);
