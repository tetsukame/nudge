import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';
import {
  AUDIT_ACTION,
  AI_FORMAT_COOLDOWN_SECONDS,
  AI_FORMAT_MAX_PER_MINUTE,
} from '../_constants';
import { AIFormatError } from './provider';

/**
 * NDG-95 (A1 S8): AI 整形 API のレート制限。
 *
 * - 同一 actor の連続呼び出しを {@link AI_FORMAT_COOLDOWN_SECONDS} 秒間隔に制限
 * - 1 分間で {@link AI_FORMAT_MAX_PER_MINUTE} 回まで
 * - 検出は audit_log に対するクエリで実装。専用テーブルは作らない
 *
 * 副作用として S9 (audit_log 網羅) も達成。各呼び出しが
 * `ai.format_requested` として残るので追跡可能。
 */

export async function assertAIFormatNotRateLimited(
  pool: pg.Pool,
  actor: ActorContext,
): Promise<void> {
  await withTenant(pool, actor.tenantId, async (client) => {
    const { rows } = await client.query<{
      last_at: Date | null;
      n: number;
    }>(
      `SELECT MAX(created_at) AS last_at, COUNT(*)::int AS n
         FROM audit_log
        WHERE actor_user_id = $1
          AND action = $2
          AND created_at > now() - interval '1 minute'`,
      [actor.userId, AUDIT_ACTION.AI_FORMAT_REQUESTED],
    );
    const last = rows[0]?.last_at;
    const n = rows[0]?.n ?? 0;

    if (n >= AI_FORMAT_MAX_PER_MINUTE) {
      throw new AIFormatError(
        `rate limited: max ${AI_FORMAT_MAX_PER_MINUTE} calls / minute`,
        'rate_limited',
      );
    }
    if (last) {
      const elapsed = (Date.now() - new Date(last).getTime()) / 1000;
      if (elapsed < AI_FORMAT_COOLDOWN_SECONDS) {
        throw new AIFormatError(
          `rate limited: ${AI_FORMAT_COOLDOWN_SECONDS}s cooldown`,
          'rate_limited',
        );
      }
    }
  });
}

/**
 * 呼び出しを audit_log に記録する。rate limit 検出にも使われる。
 * memo の中身は記録しない (個人情報・社外秘の可能性)、長さのみ。
 */
export async function recordAIFormatRequest(
  pool: pg.Pool,
  actor: ActorContext,
  memoLength: number,
): Promise<void> {
  await withTenant(pool, actor.tenantId, async (client) => {
    await client.query(
      `INSERT INTO audit_log
         (tenant_id, actor_user_id, action, target_type, target_id, payload_json)
       VALUES ($1, $2, $3, 'tenant', $1, $4::jsonb)`,
      [
        actor.tenantId,
        actor.userId,
        AUDIT_ACTION.AI_FORMAT_REQUESTED,
        JSON.stringify({ memoLength }),
      ],
    );
  });
}
