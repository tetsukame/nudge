import type pg from 'pg';
import { encryptSecret, decryptSecret } from '../notification/crypto';

/**
 * NDG-85: tenant_sync_config.sync_client_secret の読み書きを暗号化列
 * (`sync_client_secret_encrypted`) 経由に寄せる lazy migration ヘルパー。
 *
 * 旧列 `sync_client_secret` (平文) は migration 054 までは並存。read 時に
 * 暗号化列が空かつ平文列に値があれば、その場で暗号化して書き戻し、平文列を
 * NULL にクリアする (自動移行)。すべての行が移行された確認後の次リリースで
 * 別 migration により旧列を DROP する。
 */
export async function getSyncClientSecret(
  client: pg.PoolClient | pg.Pool,
  tenantId: string,
): Promise<string | null> {
  const { rows } = await client.query<{
    plain: string | null;
    enc: string | null;
  }>(
    `SELECT sync_client_secret AS plain, sync_client_secret_encrypted AS enc
       FROM tenant_sync_config WHERE tenant_id = $1`,
    [tenantId],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  if (r.enc) return decryptSecret(r.enc);
  if (!r.plain) return null;
  // Lazy migration: 平文値を暗号化して書き戻し、平文列をクリア
  const encrypted = encryptSecret(r.plain);
  await client.query(
    `UPDATE tenant_sync_config
        SET sync_client_secret_encrypted = $2,
            sync_client_secret = NULL,
            updated_at = now()
      WHERE tenant_id = $1`,
    [tenantId, encrypted],
  );
  return r.plain;
}

/**
 * 平文の secret を AES-256-GCM で暗号化して保存する。
 * 旧平文列も同時に NULL クリアして並存ウィンドウを最短化。
 * 行が存在しない場合は呼び出し元で先に INSERT を済ませること
 * (`upsertSyncConfig` 経由ならその責務になる)。
 */
export async function setSyncClientSecret(
  client: pg.PoolClient | pg.Pool,
  tenantId: string,
  plain: string | null,
): Promise<void> {
  const encrypted = plain ? encryptSecret(plain) : null;
  await client.query(
    `UPDATE tenant_sync_config
        SET sync_client_secret_encrypted = $2,
            sync_client_secret = NULL,
            updated_at = now()
      WHERE tenant_id = $1`,
    [tenantId, encrypted],
  );
}

/**
 * tenant_sync_config 行の存在判定。upsertSyncConfig 等から使う。
 */
export async function hasSyncClientSecret(
  client: pg.PoolClient | pg.Pool,
  tenantId: string,
): Promise<boolean> {
  const { rows } = await client.query<{ has: boolean }>(
    `SELECT (sync_client_secret IS NOT NULL OR sync_client_secret_encrypted IS NOT NULL) AS has
       FROM tenant_sync_config WHERE tenant_id = $1`,
    [tenantId],
  );
  return rows[0]?.has ?? false;
}
