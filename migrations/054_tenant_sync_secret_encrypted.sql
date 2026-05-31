-- NDG-85 (X1): tenant_sync_config.sync_client_secret を暗号化保存に移行。
-- 旧列 `sync_client_secret` は後方互換のため残し、コード側で lazy migration
-- (read 時に暗号化列が空なら旧列の値を AES-256-GCM で暗号化して書き戻し、
-- 旧列をクリア) する。完了確認後の次リリースで別 migration で DROP する。

ALTER TABLE tenant_sync_config
  ADD COLUMN sync_client_secret_encrypted TEXT;
