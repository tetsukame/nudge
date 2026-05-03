-- 041: Allow 'full-with-orgs' as a sync_type value (NDG-22)
-- v0.4 の sync_log は ('full', 'delta') のみ受け入れていたが、
-- /root/sync の「Full + 組織同期」モードで 'full-with-orgs' を INSERT
-- すると CHECK 違反になる。この値を許可するよう拡張。

ALTER TABLE sync_log DROP CONSTRAINT sync_log_sync_type_check;
ALTER TABLE sync_log ADD CONSTRAINT sync_log_sync_type_check
  CHECK (sync_type IN ('full', 'delta', 'full-with-orgs'));
