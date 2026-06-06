-- NDG-88 (NDG-87 retention 設計 1/3):
-- - retention_config テーブル新設 (tenant 単位の保持期間設定)
-- - 既存 4 テーブルに archived_at TIMESTAMPTZ を追加 (論理削除フラグ)
-- - archived_at に部分インデックスを張る (ハード削除候補を高速にスキャン)
--
-- デフォルトは enabled=false で、既存環境の挙動は変更なし。
-- platform デフォルト保持期間は loadConfig() 側で持つ (Node 側の責務)。
-- hard_delete_enabled も別フラグでオプトイン (デフォルト false)。

CREATE TABLE retention_config (
  tenant_id              UUID PRIMARY KEY REFERENCES tenant(id),
  enabled                BOOLEAN NOT NULL DEFAULT false,
  hard_delete_enabled    BOOLEAN NOT NULL DEFAULT false,
  notification_days      INT,
  audit_log_days         INT,
  history_days           INT,
  sync_log_days          INT,
  soft_delete_grace_days INT NOT NULL DEFAULT 7,
  extras                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (notification_days     IS NULL OR notification_days     > 0),
  CHECK (audit_log_days        IS NULL OR audit_log_days        > 0),
  CHECK (history_days          IS NULL OR history_days          > 0),
  CHECK (sync_log_days         IS NULL OR sync_log_days         > 0),
  CHECK (soft_delete_grace_days > 0)
);

-- retention_config は admin pool 経由 (tenant_admin の API 経由) でのみ書き換える
-- ため RLS は不要 (= 既存の channel_config / sync_config と同じ方針)。

ALTER TABLE notification              ADD COLUMN archived_at TIMESTAMPTZ;
ALTER TABLE audit_log                 ADD COLUMN archived_at TIMESTAMPTZ;
ALTER TABLE assignment_status_history ADD COLUMN archived_at TIMESTAMPTZ;
ALTER TABLE sync_log                  ADD COLUMN archived_at TIMESTAMPTZ;

-- ハード削除対象 (archived_at IS NOT NULL) のみ高速スキャンしたいので部分インデックス
CREATE INDEX notification_archived_idx
  ON notification (archived_at) WHERE archived_at IS NOT NULL;

CREATE INDEX audit_log_archived_idx
  ON audit_log (archived_at) WHERE archived_at IS NOT NULL;

CREATE INDEX assignment_status_history_archived_idx
  ON assignment_status_history (archived_at) WHERE archived_at IS NOT NULL;

CREATE INDEX sync_log_archived_idx
  ON sync_log (archived_at) WHERE archived_at IS NOT NULL;
