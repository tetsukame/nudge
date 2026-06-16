import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getPool, getAppPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import {
  assertAIFormatNotRateLimited,
  recordAIFormatRequest,
} from '../../../../src/domain/ai/rate-limit.js';
import {
  AI_FORMAT_COOLDOWN_SECONDS,
  AI_FORMAT_MAX_PER_MINUTE,
} from '../../../../src/domain/_constants.js';
import { AIFormatError } from '../../../../src/domain/ai/provider.js';
import type { ActorContext } from '../../../../src/domain/types.js';

function ctx(s: { tenantId: string; users: { memberA: string } }): ActorContext {
  return {
    userId: s.users.memberA, tenantId: s.tenantId,
    isTenantAdmin: false, isTenantWideRequester: false,
  };
}

describe('NDG-95: AI format rate limit', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('passes when no prior call within window', async () => {
    const s = await createDomainScenario(getPool());
    await expect(
      assertAIFormatNotRateLimited(getAppPool(), ctx(s)),
    ).resolves.toBeUndefined();
  });

  it('rejects with rate_limited when called within cooldown', async () => {
    const s = await createDomainScenario(getPool());
    await recordAIFormatRequest(getAppPool(), ctx(s), 50);
    // 直後の再チェック → cooldown 内
    await expect(
      assertAIFormatNotRateLimited(getAppPool(), ctx(s)),
    ).rejects.toBeInstanceOf(AIFormatError);
  });

  it('cooldown error has code=rate_limited', async () => {
    const s = await createDomainScenario(getPool());
    await recordAIFormatRequest(getAppPool(), ctx(s), 50);
    try {
      await assertAIFormatNotRateLimited(getAppPool(), ctx(s));
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AIFormatError);
      expect((err as AIFormatError).code).toBe('rate_limited');
    }
  });

  it('rejects when minute count exceeds max', async () => {
    const s = await createDomainScenario(getPool());
    // 古いログを直接 INSERT して count を増やす (cooldown は時刻をずらす)
    for (let i = 0; i < AI_FORMAT_MAX_PER_MINUTE; i++) {
      await getPool().query(
        `INSERT INTO audit_log
           (tenant_id, actor_user_id, action, target_type, target_id, payload_json, created_at)
         VALUES ($1, $2, 'ai.format_requested', 'tenant', $1, '{}'::jsonb, now() - interval '${30 - i} seconds')`,
        [s.tenantId, s.users.memberA],
      );
    }
    await expect(
      assertAIFormatNotRateLimited(getAppPool(), ctx(s)),
    ).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('recordAIFormatRequest writes audit_log row', async () => {
    const s = await createDomainScenario(getPool());
    await recordAIFormatRequest(getAppPool(), ctx(s), 1234);
    const { rows } = await getPool().query<{
      action: string; payload_json: { memoLength: number };
    }>(
      `SELECT action, payload_json FROM audit_log
        WHERE actor_user_id = $1 AND action = 'ai.format_requested'`,
      [s.users.memberA],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].payload_json.memoLength).toBe(1234);
  });

  it('passes if last call was older than cooldown', async () => {
    const s = await createDomainScenario(getPool());
    // 古い (cooldown + 5s 前) の記録を 1 件だけ手動 INSERT
    await getPool().query(
      `INSERT INTO audit_log
         (tenant_id, actor_user_id, action, target_type, target_id, payload_json, created_at)
       VALUES ($1, $2, 'ai.format_requested', 'tenant', $1, '{}'::jsonb,
               now() - interval '${AI_FORMAT_COOLDOWN_SECONDS + 5} seconds')`,
      [s.tenantId, s.users.memberA],
    );
    await expect(
      assertAIFormatNotRateLimited(getAppPool(), ctx(s)),
    ).resolves.toBeUndefined();
  });
});
