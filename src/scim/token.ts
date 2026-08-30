import type pg from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

/**
 * NDG-115 (v0.26): SCIM Bearer token の発行・検証。
 *
 * platform_admin と同じ bcrypt hash 保存パターン。tenant あたり 1 token。
 * ローテートは同じ tenant_id に対する upsert で置換。
 *
 * 平文 token は発行時に 1 度だけ呼び出し元に返す。以降は hash しか残らない。
 */

const BCRYPT_COST = 12;
const TOKEN_BYTES = 32; // 256 bit random → base64url で 43 文字前後

/**
 * ランダム token を生成 → hash して DB に upsert → 平文を返す。
 * 既に token がある tenant では上書き (ローテート) となり、旧 token は即失効。
 */
export async function issueScimToken(
  adminPool: pg.Pool,
  tenantId: string,
): Promise<string> {
  const plain = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  const hash = await bcrypt.hash(plain, BCRYPT_COST);
  await adminPool.query(
    `INSERT INTO tenant_scim_token (tenant_id, token_hash)
     VALUES ($1, $2)
     ON CONFLICT (tenant_id) DO UPDATE SET
       token_hash = EXCLUDED.token_hash,
       created_at = now(),
       last_used_at = NULL`,
    [tenantId, hash],
  );
  return plain;
}

export async function revokeScimToken(
  adminPool: pg.Pool,
  tenantId: string,
): Promise<boolean> {
  const { rowCount } = await adminPool.query(
    `DELETE FROM tenant_scim_token WHERE tenant_id = $1`,
    [tenantId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Bearer token の検証。成功したら last_used_at を更新して true を返す。
 * 失敗理由は公開せず bool のみ。
 */
export async function verifyScimToken(
  adminPool: pg.Pool,
  tenantId: string,
  plainToken: string,
): Promise<boolean> {
  const { rows } = await adminPool.query<{ token_hash: string }>(
    `SELECT token_hash FROM tenant_scim_token WHERE tenant_id = $1`,
    [tenantId],
  );
  if (rows.length === 0) {
    // 存在しない tenant に対しても bcrypt.compare でダミー比較 (timing 対策)
    await bcrypt.compare(plainToken, '$2b$12$abcdefghijklmnopqrstuv');
    return false;
  }
  const ok = await bcrypt.compare(plainToken, rows[0].token_hash);
  if (!ok) return false;
  await adminPool.query(
    `UPDATE tenant_scim_token SET last_used_at = now() WHERE tenant_id = $1`,
    [tenantId],
  );
  return true;
}
